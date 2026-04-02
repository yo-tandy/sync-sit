import { useTranslation } from 'react-i18next';
import { TopNav, Button, InfoBanner, Card } from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { useAuthStore } from '@/stores/authStore';
import { getRecentErrors, formatErrorsForEmail } from '@/lib/errorCapture';

export function ReportProblemPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();

  const userId = userDoc?.uid ?? 'Not logged in';
  const now = new Date();
  const timeStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const version = '1.0.0';
  const platform = navigator.userAgent.includes('iPhone')
    ? 'iOS'
    : navigator.userAgent.includes('Android')
      ? 'Android'
      : 'Web';

  const recentErrors = getRecentErrors();
  const errorsForEmail = formatErrorsForEmail();
  const errorCount = recentErrors.length;

  const subject = encodeURIComponent('Problem Report');
  const body = encodeURIComponent(
    `User ID: ${userId}\nTime: ${timeStr}\nVersion: ${version}\nPlatform: ${platform}\n\nRecent errors (${errorCount}):\n${errorsForEmail}\n\n---\nDescribe your issue:\n`
  );
  const mailtoHref = `mailto:support@sync-sit.com?subject=${subject}&body=${body}`;

  return (
    <div>
      <TopNav title={t('report.title')} backTo="back" />
      <div className="px-5 pt-4">
        <p className="mb-6 text-sm leading-relaxed text-gray-500">
          {t('report.desc')}
        </p>

        <Card className="mb-6 bg-gray-50">
          <p className="mb-3 text-xs font-medium text-gray-400">
            {t('report.whatIncluded')}
          </p>
          <div className="space-y-2 text-sm text-gray-700">
            <div className="flex justify-between">
              <span>{t('report.userId')}</span>
              <span className="font-mono text-xs text-gray-500">{userId}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('report.time')}</span>
              <span className="font-mono text-xs text-gray-500">{timeStr}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('report.version')}</span>
              <span className="font-mono text-xs text-gray-500">{version}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('report.platform')}</span>
              <span className="font-mono text-xs text-gray-500">{platform}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('report.recentErrors')}</span>
              <span className="font-mono text-xs text-gray-500">
                {errorCount > 0 ? `${errorCount} ${t('report.errorsFound')}` : t('report.none')}
              </span>
            </div>
          </div>

          {/* Show recent errors */}
          {errorCount > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded border border-red-200 bg-red-50 p-2">
              {recentErrors.map((err, i) => (
                <div key={i} className="mb-1 text-xs text-red-700">
                  <span className="text-red-400">{new Date(err.timestamp).toLocaleTimeString()}</span>{' '}
                  {err.message.slice(0, 150)}
                </div>
              ))}
            </div>
          )}
        </Card>

        <InfoBanner icon="🔒" className="mb-6">
          {t('report.privacyNote')}
        </InfoBanner>

        <a href={mailtoHref}>
          <Button>
            <MailIcon className="h-[18px] w-[18px]" />
            {t('report.openEmail')}
          </Button>
        </a>
      </div>
    </div>
  );
}
