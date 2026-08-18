import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentView, DEFAULT_NOTIF_PREFS } from '@ejm/shared-core';
import type { NotifPrefs } from '@ejm/shared-core';
import {
  TopNav,
  Button,
  Card,
  InfoBanner,
  LanguageSelector,
  PhoneInput,
  useToast,
} from '@ejm/shared-ui';

// Copy-adapted from apps/web/src/pages/family/AccountPage.tsx, DELIBERATELY
// stripped down for the Sync/Study family portal (mirroring the tutor
// AccountPage's reductions):
//   - NO profile photo section: study-web has no photo storage/plumbing yet.
//   - NO push-notification plumbing (PushStatusCard, PWA toggles): study-web
//     has no FCM wiring, so notification prefs are EMAIL-ONLY here. Push
//     channels on the notifPrefs doc are preserved untouched but not editable.
//
// Identity fields are read-only (name / login-email). Contact fields
// (phone / whatsapp) write to profiles.parent.* via a nested updateDoc — the
// login email is NOT edited here (changing it via Firestore would desync
// Firebase Auth). notifPrefs writes the top-level field. familyId /
// enrollmentComplete are server/enrollment-owned and never written here.

// Email-only notification scenarios relevant to parents. `newRequest` is the
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
  const [passwordResetting, setPasswordResetting] = useState(false);

  // Notification prefs
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);

  const [error, setError] = useState<string | null>(null);

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
      setTimeout(() => setPasswordResetSent(false), 5000);
    } catch {
      setError(t('account.passwordResetFailed'));
    } finally {
      setPasswordResetting(false);
    }
  };

  // --- Notification prefs (email channel only — no FCM in study-web yet) ---
  // Write ONLY the single email channel via a dot-path. A full-object
  // `notifPrefs` write would clobber the push.* values the sit app may have
  // written after this page mounted (push channels are not editable here, so
  // our in-memory `prefs.push` can be stale).
  // EXCEPTION: when the scenario's push channel is missing from the stored
  // doc — the key is absent (older users predating a scenario, e.g.
  // references) or half-populated ({email} with no push, which pre-fix
  // toggles created) — a single-channel dot-path would leave the map
  // incomplete: sit's UI renders the missing push as off while the server
  // (missing push = on) still sends. Write the full map once instead, with
  // the missing push defaulted to the server's default-on gate (stored?.push
  // is defensive — a present push takes the dot-path branch); the next
  // toggle self-heals half-populated docs, no backfill needed. "Stored"
  // means the in-memory userDoc as of the last refresh — a concurrent
  // sit-side write between refresh and save could still be clobbered, but
  // nothing else writes these keys today.
  const savePrefs = useCallback(
    async (scenario: keyof NotifPrefs, email: boolean) => {
      if (!uid) return;
      const stored = userDoc?.notifPrefs?.[scenario];
      await updateDoc(doc(db, 'users', uid), {
        ...(stored && 'push' in stored
          ? { [`notifPrefs.${scenario}.email`]: email }
          : { [`notifPrefs.${scenario}`]: { push: stored?.push ?? true, email } }),
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
    },
    [uid, userDoc, refreshUserDoc],
  );

  const toggleEmail = async (scenario: keyof NotifPrefs) => {
    const previous = prefs;
    const current = prefs[scenario] || { push: false, email: true };
    const next = !current.email;
    setPrefs({ ...prefs, [scenario]: { ...current, email: next } });
    try {
      await savePrefs(scenario, next);
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
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
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

        {/* 4. Notification Preferences (email only — no FCM in study-web yet) */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('notifications.title')}</h3>
        <p className="mb-4 text-sm text-gray-500">{t('notifications.emailOnlyDesc')}</p>

        {SCENARIOS.map((s) => {
          const channel = prefs[s.key] || { push: false, email: true };
          return (
            <div key={s.key} className="mb-4 flex items-center justify-between">
              <div className="flex-1 pr-4">
                <p className="text-sm font-medium text-gray-900">{t(s.labelKey)}</p>
                <p className="text-xs text-gray-500">{t(s.descKey)}</p>
              </div>
              <button
                type="button"
                aria-label={t(s.labelKey)}
                onClick={() => toggleEmail(s.key)}
                className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.email ? 'bg-brand-600' : 'bg-gray-300'}`}
              >
                <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.email ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          );
        })}

        <hr className="my-6 border-gray-200" />

        {/* 5. Language */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('common.language')}</h3>
        <LanguageSelector />
      </div>
    </div>
  );
}
