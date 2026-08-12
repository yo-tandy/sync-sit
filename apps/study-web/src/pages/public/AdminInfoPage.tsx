import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@ejm/shared-ui';
import { AppSwitchMenuItem } from '@/components/ui/AppSwitchMenuItem';
import { useAuthStore } from '@/stores/authStore';

/**
 * Landing for ADMIN accounts on sync-study. There is deliberately no study
 * admin portal — every study admin surface (verifications, exemptions,
 * governance, families) lives in the sync-sit admin panel — so an admin
 * arriving here (login or cross-app handoff) gets an explanation and a
 * one-click switch back instead of bouncing off a nonexistent /admin route.
 */
export function AdminInfoPage() {
  const { t } = useTranslation();
  // The switch mints an auth-required handoff code — for a signed-out visitor
  // the button could only fail, so they get a login link instead.
  const signedIn = useAuthStore((s) => s.firebaseUser !== null);
  const authLoading = useAuthStore((s) => s.loading);
  return (
    <div className="mx-auto max-w-md px-5 pt-10 pb-8">
      <Card>
        <h2 className="mb-2 text-lg font-bold text-gray-900">{t('adminInfo.title')}</h2>
        <p className="mb-4 text-sm text-gray-600">{t('adminInfo.desc')}</p>
        {!authLoading && signedIn && (
          <div className="-mx-4 border-t border-gray-100">
            <AppSwitchMenuItem />
          </div>
        )}
        {!authLoading && !signedIn && (
          <p className="mb-3 text-sm">
            <Link to="/login" className="text-brand-600 hover:underline">
              {t('adminInfo.goToLogin')}
            </Link>
          </p>
        )}
        <Link to="/" className="text-sm text-brand-600 hover:underline">
          {t('adminInfo.backHome')}
        </Link>
      </Card>
    </div>
  );
}
