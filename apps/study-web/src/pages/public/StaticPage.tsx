import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '@ejm/shared-ui';

interface StaticPageProps {
  titleKey: string;
}

/**
 * Minimal placeholder page used by the public footer links
 * (About / Privacy / Terms / Help) until full content lands.
 * Mirrors sync-sit's static-page shell.
 */
export function StaticPage({ titleKey }: StaticPageProps) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="flex h-[52px] items-center justify-between px-5">
        <Link
          to="/"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </Link>
        <span className="text-base font-semibold">{t(titleKey)}</span>
        <div className="w-9" />
      </div>
      <div className="px-6 py-8 text-sm text-gray-500">
        {t('common.comingSoon')}
      </div>
    </div>
  );
}
