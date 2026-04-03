import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TopNav, LanguageSelector, Button, Card } from '@/components/ui';
import { BellIcon } from '@/components/ui/Icons';
import { isPushSupported, getPushPermissionStatus, requestPushPermission } from '@/lib/pushNotifications';
import type { NotifPrefs } from '@ejm/shared';

interface NotifChannel {
  push: boolean;
  email: boolean;
}

const SCENARIOS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = [
  { key: 'newRequest', labelKey: 'notifications.newRequest', descKey: 'notifications.newRequestDesc' },
  { key: 'confirmed', labelKey: 'notifications.confirmation', descKey: 'notifications.confirmationDesc' },
  { key: 'cancelled', labelKey: 'notifications.cancellation', descKey: 'notifications.cancellationDesc' },
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

export function NotificationPrefsPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const uid = firebaseUser?.uid;

  const [prefs, setPrefs] = useState<NotifPrefs>({
    newRequest: { push: true, email: true },
    confirmed: { push: true, email: true },
    cancelled: { push: true, email: true },
    reminders: { push: true, email: false },
  });

  useEffect(() => {
    if (userDoc?.notifPrefs) {
      setPrefs(userDoc.notifPrefs);
    }
  }, [userDoc]);

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
      <TopNav title={t('menu.settings')} backTo="back" />
      <div className="px-5 pt-4 pb-8">
        {/* Language */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('common.language')}</h3>
        <LanguageSelector className="mb-6" />

        <hr className="mb-6 border-gray-200" />

        {/* Push Notification Status */}
        {isPushSupported() && (
          <PushStatusCard uid={uid} />
        )}

        <hr className="mb-6 border-gray-200" />

        {/* Notifications */}
        <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('notifications.title')}</h3>
        <p className="mb-4 text-sm text-gray-500">
          {t('notifications.desc')}
        </p>

        {/* Header */}
        <div className="mb-3 flex items-center justify-end gap-6 pr-1">
          <span className="text-xs font-medium text-gray-500 w-10 text-center">{t('notifications.push')}</span>
          <span className="text-xs font-medium text-gray-500 w-10 text-center">{t('notifications.emailNotif')}</span>
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
      </div>
    </div>
  );
}
