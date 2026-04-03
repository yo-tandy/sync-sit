import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { Button, Card } from '@/components/ui';
import { BellIcon } from '@/components/ui/Icons';
import { isPushSupported, wasPrompted, markPrompted, requestPushPermission } from '@/lib/pushNotifications';

export function PushPrompt() {
  const { t } = useTranslation();
  const { firebaseUser } = useAuthStore();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!firebaseUser || !isPushSupported()) return;

    // If permission already granted, silently refresh token
    if (Notification.permission === 'granted') {
      requestPushPermission(firebaseUser.uid).catch(() => {});
      return;
    }

    // Show prompt after a short delay, only if not prompted before
    const timer = setTimeout(() => {
      if (!wasPrompted() && Notification.permission === 'default') {
        setShow(true);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [firebaseUser]);

  if (!show) return null;

  const handleEnable = async () => {
    markPrompted();
    if (firebaseUser) {
      await requestPushPermission(firebaseUser.uid);
    }
    setShow(false);
  };

  const handleDismiss = () => {
    markPrompted();
    setShow(false);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm">
      <Card className="border-red-200 bg-white shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50">
            <BellIcon className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1">
            <p className="mb-1 text-sm font-semibold text-gray-900">{t('notifications.pushPromptTitle')}</p>
            <p className="mb-3 text-xs text-gray-500">{t('notifications.pushPromptDesc')}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleEnable}>{t('notifications.enable')}</Button>
              <Button size="sm" variant="outline" onClick={handleDismiss}>{t('notifications.notNow')}</Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
