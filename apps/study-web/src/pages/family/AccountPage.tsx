import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useFlashTimer } from '@ejm/shared-ui';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import {
  getParentView,
  isRunningAsPWA,
  notifPrefPath,
  notifPrefRowsForUser,
  resolveNotifPrefsFor,
} from '@ejm/shared-core';
import type { NotifCategory, NotifChannels, NotifScope } from '@ejm/shared-core';
import {
  TopNav,
  Button,
  Card,
  InfoBanner,
  LanguageSelector,
  PhoneInput,
  useToast,
  BellIcon,
} from '@ejm/shared-ui';
import { PushStatusCard } from '@/components/ui/PushStatusCard';
import { isPushSupported } from '@/lib/pushNotifications';

// Copy-adapted from apps/web/src/pages/family/AccountPage.tsx, DELIBERATELY
// stripped down for the Sync/Study family portal (mirroring the tutor
// AccountPage's reductions):
//   - NO profile photo section: study-web has no photo storage/plumbing yet.
//
// Identity fields are read-only (name / login-email). Contact fields
// (phone / whatsapp) write to profiles.parent.* via a nested updateDoc — the
// login email is NOT edited here (changing it via Firestore would desync
// Firebase Auth). notifPrefs writes the top-level field. familyId /
// enrollmentComplete are server/enrollment-owned and never written here.

// Notification scenarios relevant to parents. `newRequest` is the
// category tutor-initiated session proposals arrive under (proposeSession),
// and `references` gates updates about endorsements the family submitted.
/**
 * Which app's preference block this page edits (issue #369). Rows come from
 * `notifPrefRowsForUser` -- one shared block plus a block per profile held --
 * narrowed to this page's own scope, so a study family is never offered
 * sync/do rows here.
 */
const PREF_APP = 'study' as const;

const PREF_LABELS: Partial<Record<NotifCategory, { labelKey: string; descKey: string }>> = {
  newRequest: { labelKey: 'notifications.proposal', descKey: 'notifications.proposalDesc' },
  confirmed: { labelKey: 'notifications.confirmation', descKey: 'notifications.confirmationDesc' },
  cancelled: { labelKey: 'notifications.cancellation', descKey: 'notifications.cancellationDesc' },
  reminders: { labelKey: 'notifications.reminder', descKey: 'notifications.reminderDesc' },
  references: { labelKey: 'notifications.endorsement', descKey: 'notifications.endorsementFamilyDesc' },
};

/** Module-level and therefore reference-stable — see the seeding effect. */
const PREF_CATEGORIES = Object.keys(PREF_LABELS) as NotifCategory[];

const BLOCK_HEADING: Record<NotifScope, string> = {
  shared: 'notifications.blockShared',
  sit: 'notifications.blockApp',
  study: 'notifications.blockApp',
  do: 'notifications.blockApp',
};

export function AccountPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc, resetPassword } = useAuthStore();
  const parent = getParentView(userDoc);
  const uid = firebaseUser?.uid;

  // Contact state (editable)
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [contactSaving, setContactSaving] = useState(false);
  const toast = useToast();

  // Password reset
  const [passwordResetSent, setPasswordResetSent] = useState(false);
  const flashAfter = useFlashTimer();
  const [passwordResetting, setPasswordResetting] = useState(false);

  // Notification prefs
  // Resolved through the SAME resolver the senders use, so a toggle rendered
  // ON is one the server will actually act on.
  const [prefs, setPrefs] = useState<Record<string, NotifChannels>>(() =>
    resolveNotifPrefsFor(undefined, PREF_APP, PREF_CATEGORIES),
  );

  const [error, setError] = useState<string | null>(null);

  // Push notifications only function when the app is installed as a PWA.
  const pwaMode = isRunningAsPWA();

  // One-shot seeding guard (same bug/fix as apps/web's StepPreferences.tsx
  // and the two AccountPages, PR #206 review; the `prefs` effect just below
  // diagnoses the same disease for a different field but was fixed with a
  // memo instead — this effect needed the guard, not a memo, since it
  // consumes several `parent` fields together): `getParentView` returns a
  // fresh object every render, so an unguarded `[parent]` effect re-fires on
  // every render this component causes — including the one this effect's own
  // setters trigger — and immediately resets phone/whatsapp back to
  // `userDoc`, undoing the keystroke that just happened.
  const seededRef = useRef(false);

  // Initialize from userDoc
  useEffect(() => {
    if (!parent) return;
    if (seededRef.current) return;
    seededRef.current = true;
    setPhone(parent.phone || '');
    setWhatsapp(parent.whatsapp || '');
    setWhatsappSameAsPhone(parent.whatsapp ? parent.whatsapp === parent.phone : true);
  }, [parent, userDoc]);

  // Seeded from a MEMO, not recomputed inside the effect above: that effect
  // re-runs whenever `parent` changes identity, and a freshly-built prefs
  // object would set state every pass and spin forever. `userDoc.notifPrefs`
  // is reference-stable between store updates, so this reseeds exactly when
  // the stored prefs actually change.
  const storedPrefs = useMemo(
    () => resolveNotifPrefsFor(userDoc?.notifPrefs, PREF_APP, PREF_CATEGORIES),
    [userDoc?.notifPrefs],
  );
  useEffect(() => {
    setPrefs(storedPrefs);
  }, [storedPrefs]);

  // --- Contact handlers ---
  const handleContactSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;
    setContactSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.parent.phone': phone || null,
        'profiles.parent.whatsapp': whatsappSameAsPhone ? (phone || null) : (whatsapp || null),
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      toast(t('account.contactSaved'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('account.contactSaveFailed');
      setError(message);
    } finally {
      setContactSaving(false);
    }
  };

  // --- Password reset ---
  const handlePasswordReset = async () => {
    if (!userDoc?.email) return;
    setPasswordResetting(true);
    try {
      await resetPassword(userDoc.email);
      setPasswordResetSent(true);
      flashAfter(() => setPasswordResetSent(false), 5000);
    } catch {
      setError(t('account.passwordResetFailed'));
    } finally {
      setPasswordResetting(false);
    }
  };

  // --- Notification prefs ---
  // Write ONLY the toggled category/channel via a dot-path: a full-object
  // `notifPrefs` write would clobber blocks the sit app (or the shared block)
  // may have written after this page mounted — issue #186's rule, unchanged.
  // `notifPrefPath` routes each category to its own block: the per-engagement
  // trio into `notifPrefs.study`, `reminders`/`references` into
  // `notifPrefs.shared` (issue #369).
  //
  // The #186 follow-up's "write the whole map when it is absent or
  // half-populated" exception is GONE, and with it the last-refresh clobber
  // window it carried: `resolveNotifPref` now merges a partial category over
  // the product default identically on the read side and in every sender, so
  // a single-channel dot-path can no longer leave the UI and the server
  // disagreeing about the channel nobody wrote.
  const savePrefs = useCallback(
    async (category: NotifCategory, channel: 'push' | 'email', value: boolean) => {
      if (!uid) return;
      await updateDoc(doc(db, 'users', uid), {
        [notifPrefPath(PREF_APP, category, channel)]: value,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
    },
    [uid, refreshUserDoc],
  );

  const toggle = async (category: NotifCategory, channel: 'push' | 'email') => {
    // In web-app mode, push toggles are inert — notifications won't be
    // delivered until the user installs the app to their home screen.
    if (channel === 'push' && !pwaMode) return;
    const previous = prefs;
    const current = prefs[category];
    const next = !current[channel];
    setPrefs({ ...prefs, [category]: { ...current, [channel]: next } });
    try {
      await savePrefs(category, channel, next);
    } catch {
      // Revert the optimistic toggle and surface the failure.
      setPrefs(previous);
      setError(t('account.notifSaveFailed'));
    }
  };

  // One shared block plus this page's own app block (issue #369).
  const prefRows = notifPrefRowsForUser(userDoc).filter(
    (r) => (r.scope === 'shared' || r.scope === PREF_APP) && PREF_LABELS[r.category],
  );

  return (
    <div>
      <TopNav title={t('account.title')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        {/* 1. Personal Info (read-only) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.personalInfo')}</h3>
        <Card className="mb-4 bg-gray-50">
          <div className="mb-3 flex gap-3">
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('enrollment.firstName')}</p>
              <p className="text-sm font-medium text-gray-900">{parent?.firstName || ''}</p>
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('enrollment.lastName')}</p>
              <p className="text-sm font-medium text-gray-900">{parent?.lastName || ''}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('account.loginEmail')}</p>
            <p className="text-sm font-medium text-gray-900">{parent?.email || ''}</p>
          </div>
        </Card>

        <hr className="mb-6 border-gray-200" />

        {/* 2. Contact Info (editable) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.contactInfo')}</h3>
        <p className="mb-4 text-xs text-gray-500">{t('family.contactDesc')}</p>

        <form onSubmit={handleContactSave} className="mb-6">
          <PhoneInput
            label={t('account.phone')}
            value={phone}
            onChange={(val) => { setPhone(val); if (whatsappSameAsPhone) setWhatsapp(val); }}
          />

          <div className="mb-5">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
              <span>WhatsApp</span>
            </label>
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={whatsappSameAsPhone}
                onChange={(e) => {
                  setWhatsappSameAsPhone(e.target.checked);
                  if (e.target.checked) setWhatsapp(phone);
                  else setWhatsapp('');
                }}
                className="h-4 w-4 rounded border-gray-300 text-brand-600"
              />
              {t('account.whatsappSameAsPhone')}
            </label>
            {!whatsappSameAsPhone && (
              <PhoneInput
                label=""
                value={whatsapp}
                onChange={setWhatsapp}
              />
            )}
          </div>

          <Button type="submit" disabled={contactSaving}>
            {contactSaving ? t('common.saving') : t('account.saveContact')}
          </Button>
        </form>

        <hr className="mb-6 border-gray-200" />

        {/* 3. Change Password */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.changePassword')}</h3>
        {passwordResetSent && (
          <InfoBanner className="mb-4">
            {t('account.passwordResetSent', { email: userDoc?.email })}
          </InfoBanner>
        )}
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={handlePasswordReset}
            disabled={passwordResetting}
          >
            {passwordResetting ? '...' : t('account.sendPasswordReset')}
          </Button>
        </div>

        <hr className="mb-6 border-gray-200" />

        {/* 4. Push Notifications — status card only shown when push can actually work (PWA mode) */}
        {pwaMode && isPushSupported() && (
          <PushStatusCard uid={uid} />
        )}

        {/* 5. Notification Preferences */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('notifications.title')}</h3>
        <p className="mb-4 text-sm text-gray-500">{t('notifications.desc')}</p>

        {/* Constant notice when push isn't available (web-app mode) */}
        {!pwaMode && (
          <Card className="mb-4 border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <BellIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                {t('notifications.pushRequiresInstall')}{' '}
                <Link to="/install" className="font-semibold underline">
                  {t('notifications.pushRequiresInstallLink')}
                </Link>
              </p>
            </div>
          </Card>
        )}

        {/* Header */}
        <div className="mb-3 flex items-center justify-end gap-6 pr-1">
          <span className="w-10 text-center text-xs font-medium text-gray-500">{t('notifications.push')}</span>
          <span className="w-10 text-center text-xs font-medium text-gray-500">{t('notifications.emailNotif')}</span>
        </div>

        {prefRows.map((row, i) => {
          const s = PREF_LABELS[row.category]!;
          const channel = prefs[row.category];
          const isBlockStart = i === 0 || prefRows[i - 1].scope !== row.scope;
          return (
            <div key={`${row.scope}.${row.category}`}>
            {isBlockStart && (
              <h4 className="mb-2 mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t(BLOCK_HEADING[row.scope])}
              </h4>
            )}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex-1 pr-4">
                <p className="text-sm font-medium text-gray-900">{t(s.labelKey)}</p>
                <p className="text-xs text-gray-500">{t(s.descKey)}</p>
              </div>
              <div className="flex items-center gap-6">
                {/* In web-app mode the toggle renders OFF (purely visual —
                    the write guard in toggle() is the real gate): showing an
                    ON toggle above a "push needs install" notice reads as a
                    contradiction (PR #192 review). */}
                <button
                  type="button"
                  onClick={() => toggle(row.category, 'push')}
                  disabled={!pwaMode}
                  aria-disabled={!pwaMode}
                  aria-label={`${t(s.labelKey)} — ${t('notifications.push')}`}
                  title={!pwaMode ? t('notifications.pushRequiresInstall') : undefined}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${pwaMode && channel.push ? 'bg-brand-600' : 'bg-gray-300'} ${!pwaMode ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${pwaMode && channel.push ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <button
                  type="button"
                  aria-label={`${t(s.labelKey)} — ${t('notifications.emailNotif')}`}
                  onClick={() => toggle(row.category, 'email')}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.email ? 'bg-brand-600' : 'bg-gray-300'}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.email ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            </div>
          );
        })}

        <hr className="my-6 border-gray-200" />

        {/* 6. Language */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('common.language')}</h3>
        <LanguageSelector />
      </div>
    </div>
  );
}
