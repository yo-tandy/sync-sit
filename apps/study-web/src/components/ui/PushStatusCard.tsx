import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, BellIcon } from '@ejm/shared-ui';
import { getPushPermissionStatus, requestPushPermission } from '@/lib/pushNotifications';

/**
 * Push-permission status card shown on the account pages when the app runs
 * in installed-PWA mode. Mirrors the PushStatusCard sit inlines in both of
 * its account pages — shared here instead of duplicated per page.
 */
export function PushStatusCard({ uid }: { uid?: string }) {
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
