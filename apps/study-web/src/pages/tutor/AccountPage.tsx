import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile, SESSION_LENGTHS, LOCATION_PREFS } from '@ejm/study-core';
import type { LocationPref } from '@ejm/study-core';
import { DEFAULT_NOTIF_PREFS } from '@ejm/shared-core';
import type { NotifPrefs } from '@ejm/shared-core';
import {
  TopNav,
  Button,
  Input,
  Card,
  InfoBanner,
  LanguageSelector,
  PhoneInput,
  Select,
} from '@ejm/shared-ui';

// Copy-adapted from apps/web/src/pages/babysitter/AccountPage.tsx, DELIBERATELY
// stripped down for the tutor portal:
//   - NO profile photo section: study-web has no photo storage/plumbing yet.
//   - NO push-notification plumbing (PushStatusCard, PWA toggles): study-web
//     has no FCM wiring, so notification prefs are EMAIL-ONLY here. Push
//     channels on the notifPrefs doc are preserved untouched but not editable.
//   - NO contactSharingConsent field/gate: unlike BabysitterProfile,
//     TutorProfile has no contactSharingConsent, so the consent checkbox and
//     the fieldset it gated are omitted.
// The babysitter page has no account-deletion section, so there is nothing to
// skip on that front.
//
// Identity fields are read-only (name/DOB/login-email/ejemEmail/classLevel);
// contact fields (contactEmail/contactPhone/whatsapp) write to profiles.tutor.*;
// notifPrefs writes to the top-level field. enrollmentComplete/verification/
// ejemEmail are server-owned and never written here.

// Email-only notification scenarios relevant to tutors.
const SCENARIOS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = [
  { key: 'newRequest', labelKey: 'notifications.newRequest', descKey: 'notifications.newRequestDesc' },
  { key: 'cancelled', labelKey: 'notifications.cancellation', descKey: 'notifications.cancellationDesc' },
  { key: 'reminders', labelKey: 'notifications.reminder', descKey: 'notifications.reminderDesc' },
];

export function AccountPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc, resetPassword } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const uid = firebaseUser?.uid;

  // Contact state (editable)
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactSuccess, setContactSuccess] = useState(false);

  // Password reset
  const [passwordResetSent, setPasswordResetSent] = useState(false);
  const [passwordResetting, setPasswordResetting] = useState(false);

  // Notification prefs
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);

  // Cancellation policy (V2 feature 7) — a preset notice window in hours.
  const [noticeHours, setNoticeHours] = useState(0);
  const [policySaving, setPolicySaving] = useState(false);
  const [policySuccess, setPolicySuccess] = useState(false);

  // Session preferences (issue #123) — the enrollment-only fields, now
  // editable: lengths + padding feed the booking slot math, locations feed
  // search filters. All three are owner-editable dot-paths.
  const [sessionLengths, setSessionLengths] = useState<number[]>([]);
  const [locationPrefs, setLocationPrefs] = useState<LocationPref[]>([]);
  const [paddingMin, setPaddingMin] = useState(0);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSuccess, setPrefsSuccess] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Initialize from userDoc
  useEffect(() => {
    if (!userDoc) return;
    setContactEmail(tutor?.contactEmail || userDoc.email || '');
    setPhone(tutor?.contactPhone || '');
    setWhatsapp(tutor?.whatsapp || '');
    setWhatsappSameAsPhone(tutor?.whatsapp ? tutor.whatsapp === tutor.contactPhone : true);
    setNoticeHours(tutor?.cancellationNoticeHours ?? 0);
    setSessionLengths(tutor?.sessionLengthsMin ?? []);
    setLocationPrefs(tutor?.locationPrefs ?? []);
    setPaddingMin(tutor?.paddingMin ?? 0);
    if (userDoc.notifPrefs) {
      setPrefs(userDoc.notifPrefs);
    }
  }, [userDoc, tutor]);

  // Format DOB for display (User.dateOfBirth is a Firestore Timestamp, but may
  // be a plain string on older records — handle both).
  const dobDisplay = (() => {
    const dob: unknown = userDoc?.dateOfBirth;
    if (!dob) return '';
    if (typeof dob === 'string') return dob;
    if (
      typeof dob === 'object' &&
      dob !== null &&
      'toDate' in dob &&
      typeof (dob as { toDate: unknown }).toDate === 'function'
    ) {
      return (dob as { toDate: () => Date }).toDate().toLocaleDateString();
    }
    return '';
  })();

  // --- Contact handlers ---
  const handleContactSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;
    setContactSaving(true);
    setContactSuccess(false);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.contactEmail': contactEmail || null,
        'profiles.tutor.contactPhone': phone || null,
        'profiles.tutor.whatsapp': whatsappSameAsPhone ? (phone || null) : (whatsapp || null),
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setContactSuccess(true);
      setTimeout(() => setContactSuccess(false), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('account.contactSaveFailed');
      setError(message);
    } finally {
      setContactSaving(false);
    }
  };

  // --- Cancellation policy ---
  // Writes only the preset dot-path (like SubjectsPage.handleSave), refreshes the
  // user doc, then shows a transient success. The value is snapshotted onto future
  // bookings server-side; editing it never retro-flags existing sessions.
  const handleSavePolicy = async () => {
    if (!uid) return;
    setPolicySaving(true);
    setPolicySuccess(false);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.cancellationNoticeHours': noticeHours,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setPolicySuccess(true);
      setTimeout(() => setPolicySuccess(false), 3000);
    } catch {
      setError(t('common.error'));
    } finally {
      setPolicySaving(false);
    }
  };

  // --- Session preferences ---
  const toggleSessionLength = (len: number) => {
    setSessionLengths((prev) =>
      prev.includes(len) ? prev.filter((l) => l !== len) : [...prev, len],
    );
    setPrefsSuccess(false);
  };

  const toggleLocationPref = (pref: LocationPref) => {
    setLocationPrefs((prev) =>
      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref],
    );
    setPrefsSuccess(false);
  };

  const handleSavePrefs = async () => {
    if (!uid) return;
    // Mirrors enrollment's StepPrefs validation: at least one length and one
    // location; padding is already clamped by the input.
    if (sessionLengths.length === 0) {
      setPrefsError(t('tutor.account.sessionPrefs.errorNoLengths'));
      setPrefsSuccess(false);
      return;
    }
    if (locationPrefs.length === 0) {
      setPrefsError(t('tutor.account.sessionPrefs.errorNoLocations'));
      setPrefsSuccess(false);
      return;
    }
    // JS bound check is the trust boundary (see AreaPage note): min/max
    // attributes never gate a plain onClick save; enrollment enforces 0-60.
    if (!Number.isInteger(paddingMin) || paddingMin < 0 || paddingMin > 60) {
      setPrefsError(t('tutor.account.sessionPrefs.errorPaddingRange'));
      setPrefsSuccess(false);
      return;
    }
    setPrefsSaving(true);
    setPrefsSuccess(false);
    setPrefsError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.sessionLengthsMin': sessionLengths,
        'profiles.tutor.locationPrefs': locationPrefs,
        'profiles.tutor.paddingMin': paddingMin,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setPrefsSuccess(true);
      setTimeout(() => setPrefsSuccess(false), 3000);
    } catch {
      setPrefsError(t('common.error'));
    } finally {
      setPrefsSaving(false);
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

  // --- Notification prefs (email channel only) ---
  const savePrefs = useCallback(async (updated: NotifPrefs) => {
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        notifPrefs: updated,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
    } catch {
      // silent
    }
  }, [uid, refreshUserDoc]);

  const toggleEmail = (scenario: keyof NotifPrefs) => {
    const current = prefs[scenario] || { push: false, email: true };
    const updated = {
      ...prefs,
      [scenario]: { ...current, email: !current.email },
    };
    setPrefs(updated);
    savePrefs(updated);
  };

  return (
    <div>
      <TopNav title={t('account.title')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        {/* 0. Supervised-account indicator (governedBy mirror — server-owned) */}
        {userDoc?.governedBy && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="mb-1 text-sm font-semibold text-blue-900">
              {t('supervision.indicatorTitle')}
            </p>
            <p className="mb-2 text-xs text-blue-800">{t('supervision.indicatorDesc')}</p>
            <Link
              to="/supervision-info"
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              {t('supervision.whatItMeans')}
            </Link>
          </div>
        )}

        {/* 1. Personal Info (read-only) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.personalInfo')}</h3>
        <Card className="mb-4 bg-gray-50">
          <div className="mb-3 flex gap-3">
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('enrollment.firstName')}</p>
              <p className="text-sm font-medium text-gray-900">{userDoc?.firstName || ''}</p>
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('enrollment.lastName')}</p>
              <p className="text-sm font-medium text-gray-900">{userDoc?.lastName || ''}</p>
            </div>
          </div>
          <div className="mb-3">
            <p className="text-xs text-gray-500">{t('account.loginEmail')}</p>
            <p className="text-sm font-medium text-gray-900">{userDoc?.email || ''}</p>
          </div>
          {tutor?.ejemEmail && tutor.ejemEmail !== userDoc?.email && (
            <div className="mb-3">
              <p className="text-xs text-gray-500">{t('account.ejemEmail')}</p>
              <p className="text-sm font-medium text-gray-900">{tutor.ejemEmail}</p>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('account.dateOfBirth')}</p>
              <p className="text-sm font-medium text-gray-900">{dobDisplay || '—'}</p>
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('account.classLevel')}</p>
              <p className="text-sm font-medium text-gray-900">{tutor?.classLevel || '—'}</p>
            </div>
          </div>
        </Card>

        <hr className="mb-6 border-gray-200" />

        {/* 2. Contact Info (editable) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.contactInfo')}</h3>
        <p className="mb-4 text-xs text-gray-500">{t('account.contactDesc')}</p>

        {contactSuccess && <InfoBanner className="mb-4">{t('account.contactSaved')}</InfoBanner>}
        <form onSubmit={handleContactSave} className="mb-6">
          <Input
            label={t('common.email')}
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
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

        {/* 3. Cancellation policy */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">
          {t('tutor.account.cancellationPolicy.title')}
        </h3>
        <p className="mb-4 text-xs text-gray-500">{t('tutor.account.cancellationPolicy.help')}</p>

        {policySuccess && (
          <InfoBanner className="mb-4">{t('tutor.account.cancellationPolicy.saved')}</InfoBanner>
        )}
        <Select
          aria-label={t('tutor.account.cancellationPolicy.title')}
          value={String(noticeHours)}
          onChange={(e) => {
            setNoticeHours(Number(e.target.value));
            setPolicySuccess(false);
          }}
          options={[
            { value: '0', label: t('tutor.account.cancellationPolicy.none') },
            { value: '24', label: t('tutor.account.cancellationPolicy.hours24') },
            { value: '48', label: t('tutor.account.cancellationPolicy.hours48') },
            { value: '168', label: t('tutor.account.cancellationPolicy.week1') },
          ]}
        />
        <Button onClick={handleSavePolicy} disabled={policySaving} className="mb-6">
          {policySaving ? t('common.saving') : t('tutor.account.cancellationPolicy.save')}
        </Button>

        <hr className="mb-6 border-gray-200" />

        {/* 4. Session preferences (issue #123 — previously enrollment-frozen) */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">
          {t('tutor.account.sessionPrefs.title')}
        </h3>
        <p className="mb-4 text-xs text-gray-500">{t('tutor.account.sessionPrefs.help')}</p>

        {prefsSuccess && (
          <InfoBanner className="mb-4">{t('tutor.account.sessionPrefs.saved')}</InfoBanner>
        )}

        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            {t('tutor.account.sessionPrefs.lengths')}
          </label>
          <div className="flex flex-wrap gap-2">
            {SESSION_LENGTHS.map((len) => (
              <button
                key={len}
                type="button"
                aria-pressed={sessionLengths.includes(len)}
                onClick={() => toggleSessionLength(len)}
                className={`rounded-lg border-[1.5px] px-4 py-2 text-sm font-medium transition-colors ${
                  sessionLengths.includes(len)
                    ? 'border-brand-600 bg-brand-50 text-brand-600'
                    : 'border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
              >
                {len} min
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            {t('tutor.account.sessionPrefs.locations')}
          </label>
          <div className="flex flex-col gap-2">
            {LOCATION_PREFS.map((pref) => (
              <label key={pref} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={locationPrefs.includes(pref)}
                  onChange={() => toggleLocationPref(pref)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {t(`tutor.account.sessionPrefs.location.${pref}`)}
              </label>
            ))}
          </div>
        </div>

        <Input
          label={t('tutor.account.sessionPrefs.padding')}
          type="number"
          value={paddingMin}
          onChange={(e) => {
            setPaddingMin(parseInt(e.target.value) || 0);
            setPrefsSuccess(false);
          }}
          min={0}
          max={60}
        />
        <p className="-mt-4 mb-4 text-xs text-gray-400">
          {t('tutor.account.sessionPrefs.paddingHint')}
        </p>

        {prefsError && <p className="mb-4 text-sm text-brand-600">{prefsError}</p>}
        <Button onClick={handleSavePrefs} disabled={prefsSaving} className="mb-6">
          {prefsSaving ? t('common.saving') : t('tutor.account.sessionPrefs.save')}
        </Button>

        <hr className="mb-6 border-gray-200" />

        {/* 5. Area (edited on its own page — heavy address/geocode UI) */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('tutor.area.title')}</h3>
        <p className="mb-3 text-xs text-gray-500">{t('tutor.account.areaLinkDesc')}</p>
        <Link
          to="/tutor/area"
          className="mb-6 inline-block text-sm font-semibold text-brand-600 hover:underline"
        >
          {t('tutor.account.areaLink')}
        </Link>

        <hr className="my-6 border-gray-200" />

        {/* 6. Change Password */}
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

        {/* 7. Notification Preferences (email only — no FCM in study-web yet) */}
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

        {/* 8. Language */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('common.language')}</h3>
        <LanguageSelector />
      </div>
    </div>
  );
}
