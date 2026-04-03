import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, Button, Input, Card, InfoBanner, LanguageSelector } from '@/components/ui';
import { BellIcon } from '@/components/ui/Icons';
import { isPushSupported, getPushPermissionStatus, requestPushPermission } from '@/lib/pushNotifications';
import { PhoneInput } from '@/components/forms/PhoneInput';
import type { ParentUser, NotifPrefs } from '@ejm/shared';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

interface NotifChannel {
  push: boolean;
  email: boolean;
}

// Parent-specific notification scenarios (no "new request" — parents initiate requests)
const SCENARIOS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = [
  { key: 'confirmed', labelKey: 'notifications.confirmation', descKey: 'notifications.confirmationDesc' },
  { key: 'cancelled', labelKey: 'notifications.declineOrCancel', descKey: 'notifications.declineOrCancelDesc' },
  { key: 'reminders', labelKey: 'notifications.reminder', descKey: 'notifications.reminderDesc' },
];

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

export function AccountPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc, resetPassword } = useAuthStore();
  const parent = userDoc as ParentUser | null;
  const uid = firebaseUser?.uid;

  // Photo state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  // Contact state
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactSuccess, setContactSuccess] = useState(false);

  // Password reset state
  const [passwordResetSent, setPasswordResetSent] = useState(false);
  const [passwordResetting, setPasswordResetting] = useState(false);

  // Notification prefs state
  const [prefs, setPrefs] = useState<NotifPrefs>({
    newRequest: { push: true, email: true },
    confirmed: { push: true, email: true },
    cancelled: { push: true, email: true },
    reminders: { push: true, email: false },
  });

  // General UI state
  const [error, setError] = useState<string | null>(null);

  // Initialize from userDoc
  useEffect(() => {
    if (!parent) return;
    setEmail(parent.email || '');
    setPhone((parent as any).phone || '');
    setWhatsapp((parent as any).whatsapp || '');
    setWhatsappSameAsPhone((parent as any).whatsapp ? (parent as any).whatsapp === (parent as any).phone : true);
    if ((parent as any).photoUrl) {
      setPhotoPreview((parent as any).photoUrl);
    }
    if (parent.notifPrefs) {
      setPrefs(parent.notifPrefs);
    }
  }, [parent]);

  // --- Photo handlers ---
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

  const handleRemovePhoto = async () => {
    if (!uid) return;
    setPhotoPreview(null);
    setPhotoFile(null);
    setPhotoError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        photoUrl: null,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
    } catch {
      // silent
    }
  };

  const handlePhotoSave = async () => {
    if (!uid || !photoFile) return;
    setPhotoSaving(true);
    setError(null);
    try {
      const ext = photoFile.name.split('.').pop() || 'jpg';
      const path = `profile-photos/${uid}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, photoFile);
      const photoUrl = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', uid), {
        photoUrl,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setPhotoFile(null);
    } catch (err: any) {
      setError(err.message || t('account.photoUploadFailed'));
    } finally {
      setPhotoSaving(false);
    }
  };

  // Auto-save photo after selection
  useEffect(() => {
    if (photoFile) {
      handlePhotoSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoFile]);

  // --- Contact handlers ---
  const handleContactSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return;
    setContactSaving(true);
    setContactSuccess(false);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        email,
        phone: phone || null,
        whatsapp: whatsappSameAsPhone ? (phone || null) : (whatsapp || null),
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setContactSuccess(true);
      setTimeout(() => setContactSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || t('account.contactSaveFailed'));
    } finally {
      setContactSaving(false);
    }
  };

  // --- Password reset ---
  const handlePasswordReset = async () => {
    if (!parent?.email) return;
    setPasswordResetting(true);
    try {
      await resetPassword(parent.email);
      setPasswordResetSent(true);
      setTimeout(() => setPasswordResetSent(false), 5000);
    } catch {
      setError(t('account.passwordResetFailed'));
    } finally {
      setPasswordResetting(false);
    }
  };

  // --- Notification prefs ---
  const savePrefs = useCallback(async (updated: NotifPrefs) => {
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        notifPrefs: updated,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
    } catch {
      // silent — will retry on next toggle
    }
  }, [uid, refreshUserDoc]);

  const toggle = (scenario: keyof NotifPrefs, channel: 'push' | 'email') => {
    const updated = {
      ...prefs,
      [scenario]: {
        ...prefs[scenario],
        [channel]: !(prefs[scenario] as NotifChannel)[channel],
      },
    };
    setPrefs(updated);
    savePrefs(updated);
  };

  return (
    <div>
      <TopNav title={t('menu.myAccount')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {/* 1. Personal Info (read-only) */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.personalInfo')}</h3>
        <Card className="mb-6 bg-gray-50">
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
              <button type="button" onClick={handleRemovePhoto} className="text-sm font-medium text-red-600">
                {t('enrollment.removePhoto')}
              </button>
            ) : (
              <p className="text-sm font-medium">{t('enrollment.addPhoto')}</p>
            )}
            <p className="text-xs text-gray-400">{t('enrollment.photoOptional')}</p>
            {photoError && <p className="text-xs text-red-600">{photoError}</p>}
            {photoSaving && <p className="text-xs text-gray-500">{t('common.saving')}</p>}
          </div>
        </div>

        <hr className="mb-6 border-gray-200" />

        {/* 3. Contact Info */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.contactInfo')}</h3>
        {contactSuccess && <InfoBanner className="mb-4">{t('account.contactSaved')}</InfoBanner>}
        <form onSubmit={handleContactSave} className="mb-6">
          <Input
            label={t('common.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
                }}
                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
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

          <Button type="submit" disabled={contactSaving || !email}>
            {contactSaving ? t('common.saving') : t('account.saveContact')}
          </Button>
        </form>

        <hr className="mb-6 border-gray-200" />

        {/* 4. Change Password */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('account.changePassword')}</h3>
        {passwordResetSent && (
          <InfoBanner className="mb-4">
            {t('account.passwordResetSent', { email: parent?.email })}
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

        {/* 5. Push Notifications */}
        {isPushSupported() && (
          <PushStatusCard uid={uid} />
        )}

        {/* 6. Notification Preferences */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('notifications.title')}</h3>
        <p className="mb-4 text-sm text-gray-500">{t('notifications.desc')}</p>

        {/* Header */}
        <div className="mb-3 flex items-center justify-end gap-6 pr-1">
          <span className="w-10 text-center text-xs font-medium text-gray-500">{t('notifications.push')}</span>
          <span className="w-10 text-center text-xs font-medium text-gray-500">{t('notifications.emailNotif')}</span>
        </div>

        {/* Scenarios */}
        {SCENARIOS.map((s) => {
          const channel = prefs[s.key] as NotifChannel;
          return (
            <div key={s.key} className="mb-4 flex items-center justify-between">
              <div className="flex-1 pr-4">
                <p className="text-sm font-medium text-gray-900">{t(s.labelKey)}</p>
                <p className="text-xs text-gray-500">{t(s.descKey)}</p>
              </div>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => toggle(s.key, 'push')}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.push ? 'bg-red-600' : 'bg-gray-300'}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.push ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <button
                  type="button"
                  onClick={() => toggle(s.key, 'email')}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.email ? 'bg-red-600' : 'bg-gray-300'}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.email ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
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
