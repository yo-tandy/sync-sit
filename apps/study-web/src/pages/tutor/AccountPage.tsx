import { useState, useEffect, useCallback, useRef } from 'react';
import { useFlashTimer } from '@ejm/shared-ui';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';
import { DEFAULT_NOTIF_PREFS, isRunningAsPWA, getEjemEmail, getContact } from '@ejm/shared-core';
import type { NotifPrefs } from '@ejm/shared-core';
import {
  TopNav,
  Button,
  Input,
  Card,
  InfoBanner,
  LanguageSelector,
  PhoneInput,
  useToast,
  BellIcon,
} from '@ejm/shared-ui';
import { PushStatusCard } from '@/components/ui/PushStatusCard';
import { isPushSupported } from '@/lib/pushNotifications';

// Copy-adapted from apps/web/src/pages/babysitter/AccountPage.tsx, DELIBERATELY
// stripped down for the tutor portal:
//   - NO contactSharingConsent field/gate: unlike BabysitterProfile,
//     TutorProfile has no contactSharingConsent, so the consent checkbox and
//     the fieldset it gated are omitted.
// The babysitter page has no account-deletion section, so there is nothing to
// skip on that front.
//
// Identity fields are read-only (name/DOB/login-email/ejemEmail/classLevel);
// contact fields (contactEmail/contactPhone/whatsapp) write to the canonical
// ROOT fields (issue #203 shared identity) and read root ?? nested;
// notifPrefs writes to the top-level field. enrollmentComplete/verification/
// ejemEmail are server-owned and never written here.
//
// Issue #169: the session-preferences and cancellation-policy sections moved
// to SchedulePage (booking-shaped settings live next to availability). Only
// the about-me bio stayed here, with its own save.

// Photo constraints — identical to the sit babysitter AccountPage.
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// Notification scenarios relevant to tutors. `confirmed` gates
// "family accepted your session/proposal" (respondToSession) and `references`
// gates "someone submitted an endorsement for you" (submitTutorEndorsement).
const SCENARIOS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = [
  { key: 'newRequest', labelKey: 'notifications.newRequest', descKey: 'notifications.newRequestDesc' },
  { key: 'confirmed', labelKey: 'notifications.confirmation', descKey: 'notifications.confirmationTutorDesc' },
  { key: 'cancelled', labelKey: 'notifications.cancellation', descKey: 'notifications.cancellationDesc' },
  { key: 'reminders', labelKey: 'notifications.reminder', descKey: 'notifications.reminderDesc' },
  { key: 'references', labelKey: 'notifications.endorsement', descKey: 'notifications.endorsementTutorDesc' },
];

export function AccountPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc, resetPassword } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const uid = firebaseUser?.uid;

  // Photo state — mirrors the sit babysitter photo section: auto-save on pick,
  // top-level users/{uid}.photoUrl (the field searchTutors projects into
  // search results; one photo per account across roles).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewTokenRef = useRef(0);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  // Contact state (editable)
  const [contactEmail, setContactEmail] = useState('');
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

  // About-me bio: enrollment stopped collecting it (issue #143), so this is
  // now the only editor. Owner-writable dot-path; firestore.rules bounds it
  // at 1000 chars post-state (the textarea maxLength is UX only).
  const [aboutMe, setAboutMe] = useState('');
  const [aboutMeSaving, setAboutMeSaving] = useState(false);
  const [aboutMeError, setAboutMeError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Push notifications only function when the app is installed as a PWA.
  const pwaMode = isRunningAsPWA();

  // Initialize the FORM fields from userDoc exactly once per mount: the
  // photo auto-save calls refreshUserDoc(), and re-seeding on every refresh
  // silently discarded unsaved edits elsewhere on the page (typed bio,
  // toggled lengths). The photo preview stays outside the guard — it must
  // track the stored value the auto-save just wrote.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!userDoc || seededRef.current) return;
    seededRef.current = true;
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
    setContactEmail(contact.contactEmail || (emailCleared ? '' : userDoc.email || ''));
    setPhone(contact.contactPhone || '');
    setWhatsapp(contact.whatsapp || '');
    setWhatsappSameAsPhone(
      contact.whatsapp ? contact.whatsapp === contact.contactPhone : !whatsappCleared,
    );
    setAboutMe(tutor?.aboutMe ?? '');
    if (userDoc.notifPrefs) {
      setPrefs(userDoc.notifPrefs);
    }
  }, [userDoc, tutor]);

  // Photo preview tracks the stored value on every userDoc change (the
  // auto-save path refreshes the doc after writing photoUrl).
  useEffect(() => {
    if (userDoc?.photoUrl) setPhotoPreview(userDoc.photoUrl);
  }, [userDoc]);

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

  // --- Photo handlers (auto-save, mirroring sit's babysitter AccountPage) ---
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
    // Token-guard the async reader: if the upload fails (or another pick
    // happens) before onload fires, a stale data-URI must not overwrite the
    // reverted/newer preview.
    const token = ++previewTokenRef.current;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (previewTokenRef.current === token) setPhotoPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoSelect(file);
    e.target.value = '';
  };

  // The stored download URL embeds the object path as `profile-photos%2F{uid}.{ext}` —
  // recover it so remove/replace can delete the object. Photos of 15-18-year-old
  // tutors must not survive as readable orphans after "remove".
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
      // Write first, clear the preview after — a failed removal must not
      // LOOK removed while the photo is still on the public search card.
      await updateDoc(doc(db, 'users', uid), {
        photoUrl: null,
        updatedAt: serverTimestamp(),
      });
      const oldPath = storedPhotoPath();
      if (oldPath) {
        // Best-effort: the doc field is the source of truth; a failed object
        // delete leaves an orphan we retry on the next remove/replace.
        await deleteObject(ref(storage, oldPath)).catch(() => {});
      }
      // The write succeeded — the photo IS removed. A refresh blip must not
      // claim otherwise, so it is best-effort outside the error semantics.
      setPhotoPreview(null);
      setPhotoFile(null);
      await refreshUserDoc().catch(() => {});
    } catch {
      setPhotoError(t('account.photoRemoveFailed'));
    }
  };

  const handlePhotoSave = async () => {
    if (!uid || !photoFile) return;
    setPhotoSaving(true);
    setPhotoError(null);
    try {
      // split('.').pop() returns the whole name for extensionless files (the
      // || never fires), and case must not fork storage paths (IMG.JPG vs
      // img.jpg). Mirrored in sit's babysitter AccountPage.
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
      // Replacing with a different extension orphans the old object — delete it.
      if (oldPath && oldPath !== path) {
        await deleteObject(ref(storage, oldPath)).catch(() => {});
      }
      setPhotoFile(null);
      await refreshUserDoc().catch(() => {});
    } catch {
      // Inline error where the user is looking, and an honest preview: the
      // picked image did NOT save, so fall back to what is actually stored.
      // Bump the token so a still-pending reader can't repaint the failure.
      previewTokenRef.current++;
      setPhotoError(t('account.photoUploadFailed'));
      setPhotoPreview(typeof userDoc?.photoUrl === 'string' ? userDoc.photoUrl : null);
      setPhotoFile(null);
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
  // Writes only the bio dot-path (a wholesale profiles.tutor rewrite would
  // clobber server-owned siblings like approvedFamilies). An emptied bio is
  // stored as null, not an empty string.
  const handleSaveAboutMe = async () => {
    if (!uid) return;
    setAboutMeSaving(true);
    setAboutMeError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.aboutMe': aboutMe.trim() || null,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      toast(t('tutor.account.aboutMe.saved'));
    } catch {
      setAboutMeError(t('common.error'));
    } finally {
      setAboutMeSaving(false);
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
          {getEjemEmail(userDoc) && getEjemEmail(userDoc) !== userDoc?.email && (
            <div className="mb-3">
              <p className="text-xs text-gray-500">{t('account.ejemEmail')}</p>
              <p className="text-sm font-medium text-gray-900">{getEjemEmail(userDoc)}</p>
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

        {/* 1-bis. Profile Photo (issue #143 — same mechanism as sit) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.profilePhoto')}</h3>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          data-testid="photo-input"
        />
        <div className="mb-6 flex items-center gap-4">
          <button
            type="button"
            aria-label={t('account.profilePhoto')}
            onClick={() => fileInputRef.current?.click()}
            className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-gray-400"
          >
            {photoPreview ? (
              <img src={photoPreview} alt={t('account.profilePhoto')} className="h-full w-full object-cover" />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>
          <div>
            {photoPreview ? (
              <button type="button" onClick={handleRemovePhoto} className="text-sm font-medium text-brand-600">
                {t('account.removePhoto')}
              </button>
            ) : (
              <p className="text-sm font-medium">{t('account.addPhoto')}</p>
            )}
            <p className="text-xs text-gray-500">{t('account.photoOptional')}</p>
            {photoError && <p className="text-xs text-brand-600">{photoError}</p>}
            {photoSaving && <p className="text-xs text-gray-500">{t('common.saving')}</p>}
          </div>
        </div>

        <hr className="mb-6 border-gray-200" />

        {/* 2. Contact Info (editable) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.contactInfo')}</h3>
        <p className="mb-4 text-xs text-gray-500">{t('account.contactDesc')}</p>

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

        {/* 3. About me (bio only — session prefs + cancellation policy moved
            to SchedulePage, issue #169) */}
        <div className="mb-5">
          <label htmlFor="tutor-about-me" className="mb-2 block text-sm font-semibold text-gray-700">
            {t('enrollment.aboutMe')} <span className="font-normal text-gray-500">({t('common.optional')})</span>
          </label>
          <textarea
            id="tutor-about-me"
            value={aboutMe}
            onChange={(e) => setAboutMe(e.target.value)}
            placeholder={t('enrollment.aboutMePlaceholder')}
            rows={4}
            maxLength={1000}
            className="w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 py-3 text-base outline-none transition-colors focus:border-brand-600"
          />
        </div>

        {aboutMeError && <p className="mb-4 text-sm text-brand-600">{aboutMeError}</p>}
        <Button onClick={handleSaveAboutMe} disabled={aboutMeSaving} className="mb-6">
          {aboutMeSaving ? t('common.saving') : t('tutor.account.aboutMe.save')}
        </Button>

        <hr className="mb-6 border-gray-200" />

        {/* 4. Area (edited on its own page — heavy address/geocode UI) */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('tutor.area.title')}</h3>
        <p className="mb-3 text-xs text-gray-500">{t('tutor.account.areaLinkDesc')}</p>
        <Link
          to="/tutor/area"
          className="mb-6 inline-block text-sm font-semibold text-brand-600 hover:underline"
        >
          {t('tutor.account.areaLink')}
        </Link>

        <hr className="my-6 border-gray-200" />

        {/* 5. Change Password */}
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

        {/* 6. Push Notifications — status card only shown when push can actually work (PWA mode) */}
        {pwaMode && isPushSupported() && (
          <PushStatusCard uid={uid} />
        )}

        {/* 7. Notification Preferences */}
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

        {/* 8. Language */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('common.language')}</h3>
        <LanguageSelector />
      </div>
    </div>
  );
}
