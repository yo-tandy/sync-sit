import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
import { router } from '@/router';

/**
 * Consumes the auth store's forcedSignOut flag (issue #181): when another
 * session ran signOutEverywhere and the doc watcher force-signed this one
 * out, announce it and land on '/'. Mounted once at the app root, inside
 * ToastProvider but OUTSIDE the router — hence router.navigate, not
 * useNavigate. Renders nothing.
 */
export function ForcedSignOutWatcher() {
  const { t } = useTranslation();
  const toast = useToast();
  const forcedSignOut = useAuthStore((s) => s.forcedSignOut);
  const acknowledgeForcedSignOut = useAuthStore((s) => s.acknowledgeForcedSignOut);

  useEffect(() => {
    if (!forcedSignOut) return;
    const consume = () => {
      acknowledgeForcedSignOut();
      toast(t('auth.signedOutEverywhere'));
      void router.navigate('/');
    };
    // The tab receiving a cross-app force-sign-out is usually the
    // BACKGROUNDED one, and the toast auto-dismisses after ~3s — fired while
    // hidden it would expire unseen. Hold the announcement until the tab is
    // visible again so it actually lands.
    if (document.visibilityState === 'visible') {
      consume();
      return;
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      consume();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [forcedSignOut, acknowledgeForcedSignOut, toast, t]);

  return null;
}
