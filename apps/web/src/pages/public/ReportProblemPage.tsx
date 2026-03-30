import { useTranslation } from 'react-i18next';
import { TopNav, Button, InfoBanner, Card } from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { useAuthStore } from '@/stores/authStore';

export function ReportProblemPage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();

  const userId = userDoc?.uid ?? 'Not logged in';
  const now = new Date();
  const timeStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' CET';
  const version = '1.0.0';
  const platform = navigator.userAgent.includes('iPhone')
    ? 'iOS'
    : navigator.userAgent.includes('Android')
      ? 'Android'
      : 'Web';

  const subject = encodeURIComponent('Problem Report');
  const body = encodeURIComponent(
    `User ID: ${userId}\nTime: ${timeStr}\nVersion: ${version}\nPlatform: ${platform}\nRecent errors: None\n\nDescribe your issue:\n`
  );
  const mailtoHref = `mailto:support@ejm-babysitting.com?subject=${subject}&body=${body}`;

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
              <span className="font-mono text-xs text-gray-500">{t('report.none')}</span>
            </div>
          </div>
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
