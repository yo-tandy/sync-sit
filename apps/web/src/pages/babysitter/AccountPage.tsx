import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFlashTimer } from '@ejm/shared-ui';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { isRunningAsPWA } from '@ejm/sit-core';
import { db, storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, Button, Input, Card, InfoBanner, LanguageSelector, Textarea, useToast } from '@/components/ui';
import { BellIcon } from '@/components/ui/Icons';
import { isPushSupported, getPushPermissionStatus, requestPushPermission } from '@/lib/pushNotifications';
import { PhoneInput } from '@/components/forms/PhoneInput';
import type { NotifCategory, NotifChannels, NotifScope } from '@ejm/sit-core';
import {
  getBabysitterView,
  getEjemEmail,
  getContact,
  notifPrefPath,
  notifPrefRowsForUser,
  resolveNotifPrefsFor,
} from '@ejm/sit-core';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * Which app's preference block this page edits (issue #369). The rows
 * themselves come from `notifPrefRowsForUser` -- one shared block plus a
 * block per profile the user holds -- narrowed to this page's own scope and
 * to the categories a sitter is shown. A sitter therefore never sees a
 * sync/do row here, and could not even if they held a doer profile: that is
 * the shared account hub's job (#367), not a per-app Account page's.
 */
const PREF_APP = 'sit' as const;

const PREF_LABELS: Partial<Record<NotifCategory, { labelKey: string; descKey: string }>> = {
  newRequest: { labelKey: 'notifications.newRequest', descKey: 'notifications.newRequestDesc' },
  cancelled: { labelKey: 'notifications.cancellation', descKey: 'notifications.cancellationDesc' },
  reminders: { labelKey: 'notifications.reminder', descKey: 'notifications.reminderDesc' },
  references: { labelKey: 'notifications.references', descKey: 'notifications.referencesDesc' },
};

/** Module-level and therefore reference-stable — see the seeding effect. */
const PREF_CATEGORIES = Object.keys(PREF_LABELS) as NotifCategory[];

const BLOCK_HEADING: Record<NotifScope, string> = {
  shared: 'notifications.blockShared',
  sit: 'notifications.blockApp',
  study: 'notifications.blockApp',
  do: 'notifications.blockApp',
};

function getGenderOptions(t: (key: string) => string) {
  return [
    { value: 'female', label: t('enrollment.genderFemale') },
    { value: 'male', label: t('enrollment.genderMale') },
    { value: 'other', label: t('enrollment.genderOther') },
    { value: 'prefer_not_to_say', label: t('enrollment.genderPreferNot') },
  ];
}

function PushStatusCard({ uid }: { uid?: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(getPushPermissionStatus());
  const [enabling, setEnabling] = useState(false);

  const handleEnable = async () => {
    if (!uid) return;
    setEnabling(true);
    try {
      const token = await requestPushPermission(uid);
      setStatus(token ? 'granted' : Notification.permission);
    } catch {
      setStatus(Notification.permission);
    } finally {
      setEnabling(false);
    }
  };

  return (
    <Card className={`mb-6 ${status === 'granted' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-start gap-3">
        <BellIcon className={`mt-0.5 h-5 w-5 shrink-0 ${status === 'granted' ? 'text-green-600' : 'text-amber-600'}`} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${status === 'granted' ? 'text-green-800' : 'text-amber-800'}`}>
            {t('notifications.pushStatus')}
          </p>
          {status === 'granted' ? (
            <p className="text-xs text-green-600">{t('notifications.pushEnabled')}</p>
          ) : status === 'denied' ? (
            <>
              <p className="mb-2 text-xs text-amber-600">{t('notifications.pushDenied')}</p>
              <Button size="sm" variant="outline" onClick={handleEnable}>
                {t('notifications.tryAgain')}
              </Button>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs text-amber-600">{t('notifications.pushDisabled')}</p>
              <Button size="sm" onClick={handleEnable} disabled={enabling}>
                {enabling ? '...' : t('notifications.enable')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export function BabysitterAccountPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc, resetPassword } = useAuthStore();
  const babysitter = getBabysitterView(userDoc);
  const uid = firebaseUser?.uid;

  // Photo state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  // Contact state
  const [contactSharingConsent, setContactSharingConsent] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [contactSaving, setContactSaving] = useState(false);
  const toast = useToast();

  // About-me bio (issue #171 — moved here from the Babysitting Options page to
  // match the study tutor AccountPage). Seeded exactly once per mount: the
  // photo auto-save calls refreshUserDoc(), and re-seeding on every refresh
  // would silently discard a typed-but-unsaved bio. The 1000-char maxLength is
  // UX only — unlike study, sit's firestore.rules carries no server-side bound
  // for babysitter aboutMe.
  const aboutMeSeededRef = useRef(false);
  const [aboutMe, setAboutMe] = useState('');
  const [aboutMeSaving, setAboutMeSaving] = useState(false);

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

  // Contact + consent form fields are seeded exactly ONCE per mount (same
  // rationale as aboutMeSeededRef below): `babysitter` is a fresh object on
  // every render, so this effect re-runs after every keystroke — unguarded,
  // it REVERTED typed-but-unsaved contact edits back to the stored values
  // (pre-existing bug, surfaced by the issue #203 root-only write tests).
  const contactSeededRef = useRef(false);

  // Initialize from userDoc
  useEffect(() => {
    if (!babysitter) return;
    if (!contactSeededRef.current) {
      contactSeededRef.current = true;
      setContactSharingConsent(babysitter.contactSharingConsent || false);
      // Contact resolves root ?? nested (issue #203): a root-only edit made on
      // the other app (or here) wins over the frozen nested enrollment copy.
      const contact = getContact(userDoc);
      // Cleared-vs-absent drives the two defaults: a channel the user
      // DELETED must not be re-proposed as the login email, nor re-checked
      // as "same as phone" — either would republish it at the canonical root
      // on the next save, undoing the deletion one layer above where rounds
      // 3/4 enforce it (PR #206 review).
      const rootRaw = userDoc as unknown as Record<string, unknown>;
      const emailCleared = rootRaw.contactEmail !== undefined && !contact.contactEmail;
      const whatsappCleared = rootRaw.whatsapp !== undefined && !contact.whatsapp;
      setContactEmail(contact.contactEmail || (emailCleared ? '' : babysitter.email || ''));
      setPhone(contact.contactPhone || '');
      setWhatsapp(contact.whatsapp || '');
      setWhatsappSameAsPhone(
        contact.whatsapp ? contact.whatsapp === contact.contactPhone : !whatsappCleared,
      );
    }
    if (!aboutMeSeededRef.current) {
      aboutMeSeededRef.current = true;
      setAboutMe(babysitter.aboutMe || '');
    }
    if (babysitter.photoUrl) {
      setPhotoPreview(babysitter.photoUrl);
    }
  }, [babysitter, userDoc]);

  // Seeded from a MEMO, not recomputed inside the effect above: that effect
  // re-runs on every render (`babysitter` is a fresh object each time), and a
  // freshly-built prefs object would set state every pass and spin forever.
  // `userDoc.notifPrefs` is reference-stable between store updates, so this
  // reseeds exactly when the stored prefs actually change.
  const storedPrefs = useMemo(
    () => resolveNotifPrefsFor(userDoc?.notifPrefs, PREF_APP, PREF_CATEGORIES),
    [userDoc?.notifPrefs],
  );
  useEffect(() => {
    setPrefs(storedPrefs);
  }, [storedPrefs]);

  // Format DOB for display
  const dobDisplay = (() => {
    if (!babysitter?.dateOfBirth) return '';
    const dob: unknown = babysitter.dateOfBirth;
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

  // --- Photo handlers (auto-save) ---
  const handlePhotoSelect = (file: File) => {
    setPhotoError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError(t('account.photoInvalidType'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPhotoError(t('account.photoTooLarge'));
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoSelect(file);
    e.target.value = '';
  };

  // The stored download URL embeds the object path as
  // `profile-photos%2F{uid}.{ext}` — recover it so remove/replace can delete
  // the object. Photos of teenage babysitters must not survive as readable
  // orphans (mirrors the study tutor AccountPage).
  const storedPhotoPath = (): string | null => {
    const url = userDoc?.photoUrl;
    if (typeof url !== 'string') return null;
    const m = url.match(/profile-photos%2F([^?]+)/);
    return m ? `profile-photos/${decodeURIComponent(m[1])}` : null;
  };

  const handleRemovePhoto = async () => {
    if (!uid) return;
    setPhotoError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        photoUrl: null,
        updatedAt: serverTimestamp(),
      });
      const oldPath = storedPhotoPath();
      if (oldPath) {
        await deleteObject(ref(storage, oldPath)).catch(() => {});
      }
      setPhotoPreview(null);
      setPhotoFile(null);
      await refreshUserDoc().catch(() => {});
    } catch {
      // Honest failure (parity with study): the photo is still live on the
      // public search results — a silent no-op left the user believing it
      // was removed.
      setPhotoError(t('account.photoRemoveFailed'));
    }
  };

  const handlePhotoSave = async () => {
    if (!uid || !photoFile) return;
    setPhotoSaving(true);
    setError(null);
    try {
      const ext = (photoFile.name.includes('.') ? photoFile.name.split('.').pop()! : 'jpg').toLowerCase();
      const oldPath = storedPhotoPath();
      const path = `profile-photos/${uid}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, photoFile);
      const photoUrl = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', uid), {
        photoUrl,
        updatedAt: serverTimestamp(),
      });
      // Replacing under a different path (e.g. legacy .JPG -> .jpg after the
      // lowercase normalization) orphans the old readable object — delete it.
      if (oldPath && oldPath !== path) {
        await deleteObject(ref(storage, oldPath)).catch(() => {});
      }
      await refreshUserDoc();
      setPhotoFile(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('account.photoUploadFailed');
      setError(message);
    } finally {
      setPhotoSaving(false);
    }
  };

  // Auto-save photo after selection
  useEffect(() => {
    if (photoFile) handlePhotoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoFile]);

  // --- Contact handlers ---
  const handleContactSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;
    setContactSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.babysitter.contactSharingConsent': contactSharingConsent,
        // Contact is canonical at the ROOT (issue #203 shared identity):
        // Account edits write root ONLY; readers resolve root ?? nested, so
        // the stale nested copy stops mattering the moment this lands.
        contactEmail: contactEmail || null,
        contactPhone: phone || null,
        whatsapp: whatsappSameAsPhone ? (phone || null) : (whatsapp || null),
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

  // --- About me ---
  const handleAboutMeSave = async () => {
    if (!uid) return;
    setAboutMeSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.babysitter.aboutMe': aboutMe.trim() || null,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      toast(t('profile.saved'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error');
      setError(message);
    } finally {
      setAboutMeSaving(false);
    }
  };

  // --- Password reset ---
  const handlePasswordReset = async () => {
    if (!babysitter?.email) return;
    setPasswordResetting(true);
    try {
      await resetPassword(babysitter.email);
      setPasswordResetSent(true);
      flashAfter(() => setPasswordResetSent(false), 5000);
    } catch {
      setError(t('account.passwordResetFailed'));
    } finally {
      setPasswordResetting(false);
    }
  };

  // --- Notification prefs ---
  // Write ONLY the toggled category/channel via a dot-path. A full-object
  // `notifPrefs` write would clobber blocks another app (study-web, or the
  // shared block) may have written after this page mounted. `notifPrefPath`
  // routes the category to its own block: per-engagement categories into
  // `notifPrefs.sit`, `reminders`/`references` into `notifPrefs.shared`.
  //
  // The single-channel write is now safe on its own -- `resolveNotifPref`
  // merges a half-populated category over the product default on both the
  // read and the send side, so the "write the whole map to self-heal"
  // exception the study pages carried (issue #186 follow-up) is gone.
  const savePrefs = useCallback(
    async (category: NotifCategory, channel: 'push' | 'email', value: boolean) => {
      if (!uid) return;
      try {
        await updateDoc(doc(db, 'users', uid), {
          [notifPrefPath(PREF_APP, category, channel)]: value,
          updatedAt: serverTimestamp(),
        });
        await refreshUserDoc();
      } catch {
        // silent
      }
    },
    [uid, refreshUserDoc],
  );

  const toggle = (category: NotifCategory, channel: 'push' | 'email') => {
    // In web-app mode, push toggles are inert — notifications won't be
    // delivered until the user installs the app to their home screen.
    if (channel === 'push' && !pwaMode) return;
    const next = !prefs[category][channel];
    setPrefs({
      ...prefs,
      [category]: { ...prefs[category], [channel]: next },
    });
    savePrefs(category, channel, next);
  };

  // One shared block plus this page's own app block (issue #369).
  const prefRows = notifPrefRowsForUser(userDoc).filter(
    (r) => (r.scope === 'shared' || r.scope === PREF_APP) && PREF_LABELS[r.category],
  );

  return (
    <div>
      <TopNav title={t('menu.myAccount')} backTo="/babysitter" />

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

        {/* 1. Personal Info */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.personalInfo')}</h3>
        <Card className="mb-4 bg-gray-50">
          <div className="mb-3 flex gap-3">
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('enrollment.firstName')}</p>
              <p className="text-sm font-medium text-gray-900">{babysitter?.firstName || ''}</p>
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('enrollment.lastName')}</p>
              <p className="text-sm font-medium text-gray-900">{babysitter?.lastName || ''}</p>
            </div>
          </div>
          <div className="mb-3">
            <p className="text-xs text-gray-500">{t('account.loginEmail')}</p>
            <p className="text-sm font-medium text-gray-900">{babysitter?.email || ''}</p>
          </div>
          {getEjemEmail(userDoc) && getEjemEmail(userDoc) !== babysitter?.email && (
            <div className="mb-3">
              <p className="text-xs text-gray-500">{t('account.ejemEmail')}</p>
              <p className="text-sm font-medium text-gray-900">{getEjemEmail(userDoc)}</p>
            </div>
          )}
          <div className="mb-3 flex gap-3">
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('account.dateOfBirth')}</p>
              <p className="text-sm font-medium text-gray-900">{dobDisplay || '—'}</p>
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t('account.classLevel')}</p>
              <p className="text-sm font-medium text-gray-900">{babysitter?.classLevel || '—'}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('enrollment.gender')}</p>
            <p className="text-sm font-medium text-gray-900">
              {babysitter?.gender ? getGenderOptions(t).find((o) => o.value === babysitter.gender)?.label || '—' : '—'}
            </p>
          </div>
        </Card>

        <hr className="mb-6 border-gray-200" />

        {/* 2. Profile Photo */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.profilePhoto')}</h3>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="mb-6 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-gray-400"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>
          <div>
            {photoPreview ? (
              <button type="button" onClick={handleRemovePhoto} className="text-sm font-medium text-brand-600">
                {t('enrollment.removePhoto')}
              </button>
            ) : (
              <p className="text-sm font-medium">{t('enrollment.addPhoto')}</p>
            )}
            <p className="text-xs text-gray-500">{t('enrollment.photoOptional')}</p>
            {photoError && <p className="text-xs text-brand-600">{photoError}</p>}
            {photoSaving && <p className="text-xs text-gray-500">{t('common.saving')}</p>}
          </div>
        </div>

        <hr className="mb-6 border-gray-200" />

        {/* 2-bis. About me (issue #171 — moved from Babysitting Options; matches study) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          {t('enrollment.aboutMe')} <span className="font-normal text-gray-500">({t('common.optional')})</span>
        </h3>
        <Textarea
          id="babysitter-about-me"
          aria-label={t('enrollment.aboutMe')}
          value={aboutMe}
          onChange={(e) => setAboutMe(e.target.value)}
          placeholder={t('enrollment.aboutMePlaceholder')}
          rows={4}
          maxLength={1000}
        />
        <Button onClick={handleAboutMeSave} disabled={aboutMeSaving} className="mb-6">
          {aboutMeSaving ? t('common.saving') : t('common.save')}
        </Button>

        <hr className="mb-6 border-gray-200" />

        {/* 3. Contact Info */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.contactInfo')}</h3>

        {/* Contact sharing consent */}
        <label className="mb-4 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={contactSharingConsent}
            onChange={(e) => setContactSharingConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600"
          />
          <span>{t('account.contactSharingConsent')}</span>
        </label>

        <form onSubmit={handleContactSave} className="mb-6">
          <fieldset disabled={!contactSharingConsent} className={!contactSharingConsent ? 'opacity-50' : ''}>
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

          </fieldset>
          <Button type="submit" disabled={contactSaving}>
            {contactSaving ? t('common.saving') : t('account.saveContact')}
          </Button>
        </form>

        <hr className="mb-6 border-gray-200" />

        {/* 4. Change Password */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.changePassword')}</h3>
        {passwordResetSent && (
          <InfoBanner className="mb-4">
            {t('account.passwordResetSent', { email: babysitter?.email })}
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

        {/* 5. Push Notifications — status card only shown when push can actually work (PWA mode) */}
        {pwaMode && isPushSupported() && (
          <PushStatusCard uid={uid} />
        )}

        {/* 6. Notification Preferences */}
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
                <button
                  type="button"
                  onClick={() => toggle(row.category, 'push')}
                  disabled={!pwaMode}
                  aria-disabled={!pwaMode}
                  aria-label={`${t(s.labelKey)} — ${t('notifications.push')}`}
                  title={!pwaMode ? t('notifications.pushRequiresInstall') : undefined}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.push ? 'bg-brand-600' : 'bg-gray-300'} ${!pwaMode ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.push ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <button
                  type="button"
                  onClick={() => toggle(row.category, 'email')}
                  aria-label={`${t(s.labelKey)} — ${t('notifications.emailNotif')}`}
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

        {/* 7. Language */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('common.language')}</h3>
        <LanguageSelector />
      </div>
    </div>
  );
}
