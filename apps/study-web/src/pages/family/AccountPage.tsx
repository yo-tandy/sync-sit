import { useState, useEffect, useCallback } from 'react';
import { useFlashTimer } from '@ejm/shared-ui';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentView, DEFAULT_NOTIF_PREFS, isRunningAsPWA } from '@ejm/shared-core';
import type { NotifPrefs } from '@ejm/shared-core';
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
const SCENARIOS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = [
  { key: 'newRequest', labelKey: 'notifications.proposal', descKey: 'notifications.proposalDesc' },
  { key: 'confirmed', labelKey: 'notifications.confirmation', descKey: 'notifications.confirmationDesc' },
  { key: 'cancelled', labelKey: 'notifications.cancellation', descKey: 'notifications.cancellationDesc' },
  { key: 'reminders', labelKey: 'notifications.reminder', descKey: 'notifications.reminderDesc' },
  { key: 'references', labelKey: 'notifications.endorsement', descKey: 'notifications.endorsementFamilyDesc' },
];

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
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);

  const [error, setError] = useState<string | null>(null);

  // Push notifications only function when the app is installed as a PWA.
  const pwaMode = isRunningAsPWA();

  // Initialize from userDoc
  useEffect(() => {
    if (!parent) return;
    setPhone(parent.phone || '');
    setWhatsapp(parent.whatsapp || '');
    setWhatsappSameAsPhone(parent.whatsapp ? parent.whatsapp === parent.phone : true);
    if (userDoc?.notifPrefs) {
      setPrefs(userDoc.notifPrefs);
    }
  }, [parent, userDoc]);

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
  // Write ONLY the toggled scenario/channel via a dot-path: a full-object
  // `notifPrefs` write would clobber channel values the sit app may have
  // written after this page mounted (issue #186's rule; both channels are
  // editable here now that study has push). notifPrefs is SHARED across apps
  // by design (one preference per scenario, whichever app the user toggles
  // it in); a per-app split is a tracked #168 question, not a bug.
  // EXCEPTION (issue #186 follow-up): when the stored scenario map is
  // absent or incomplete — the key predates the scenario (e.g. references)
  // or is half-populated ({email} with no push, which pre-fix toggles
  // created) — a single-channel dot-path would leave the map incomplete:
  // sit's UI renders a missing push as off while the server (missing = on)
  // still sends. Write the full map once instead, defaulting the untoggled
  // channel from the stored value or the server's default-on gate; the next
  // toggle self-heals, no backfill needed. "Stored" means the in-memory
  // userDoc as of the last refresh — a concurrent sit-side write between
  // refresh and save could still be clobbered, but nothing else writes
  // these keys today.
  const savePrefs = useCallback(
    async (scenario: keyof NotifPrefs, channel: 'push' | 'email', value: boolean) => {
      if (!uid) return;
      const stored = userDoc?.notifPrefs?.[scenario];
      // Read push BEFORE the `'push' in stored` check: in the else branch
      // tsc -b narrows `stored` to never (the declared map type always
      // carries push), so the optional access fails the CI build.
      const prevPush = stored?.push ?? true;
      const prevEmail = stored?.email ?? true;
      await updateDoc(doc(db, 'users', uid), {
        ...(stored && 'push' in stored && 'email' in stored
          ? { [`notifPrefs.${scenario}.${channel}`]: value }
          : {
              [`notifPrefs.${scenario}`]: {
                push: channel === 'push' ? value : prevPush,
                email: channel === 'email' ? value : prevEmail,
              },
            }),
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
    },
    [uid, userDoc, refreshUserDoc],
  );

  const toggle = async (scenario: keyof NotifPrefs, channel: 'push' | 'email') => {
    // In web-app mode, push toggles are inert — notifications won't be
    // delivered until the user installs the app to their home screen.
    if (channel === 'push' && !pwaMode) return;
    const previous = prefs;
    // Absent-scenario full-map rule: seed the whole channel map when the
    // stored prefs lack this scenario. The server treats an absent channel
    // as ON (`!== false`), so both channels default to true here.
    const current = prefs[scenario] || { push: true, email: true };
    const next = !current[channel];
    setPrefs({ ...prefs, [scenario]: { ...current, [channel]: next } });
    try {
      await savePrefs(scenario, channel, next);
    } catch {
      // Revert the optimistic toggle and surface the failure.
      setPrefs(previous);
      setError(t('account.notifSaveFailed'));
    }
  };

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

        {SCENARIOS.map((s) => {
          const channel = prefs[s.key] || { push: true, email: true };
          return (
            <div key={s.key} className="mb-4 flex items-center justify-between">
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
                  onClick={() => toggle(s.key, 'push')}
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
                  onClick={() => toggle(s.key, 'email')}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.email ? 'bg-brand-600' : 'bg-gray-300'}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.email ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
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
