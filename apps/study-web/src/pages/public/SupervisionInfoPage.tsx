import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '@ejm/shared-ui';

/**
 * Transparency page for supervised kids: what supervision means, stated
 * honestly per the governance design (ruling 8 — guardians see everything,
 * but can only ever decline/cancel/hide, never accept). Public route so the
 * consent flow and the kid-side surfaces can both link here.
 */
export function SupervisionInfoPage() {
  const { t } = useTranslation();

  const section = (titleKey: string, bodyKey: string) => (
    <div className="mb-5">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">{t(titleKey)}</h2>
      <p className="text-sm text-gray-600">{t(bodyKey)}</p>
    </div>
  );

  return (
    <div>
      <div className="flex h-[52px] items-center justify-between px-5">
        <Link
          to="/"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </Link>
        <span className="text-base font-semibold">{t('supervision.info.title')}</span>
        <div className="w-9" />
      </div>

      <div className="px-6 py-8">
        <p className="mb-6 text-sm text-gray-600">{t('supervision.info.intro')}</p>

        {section('supervision.info.seeTitle', 'supervision.info.seeBody')}
        {section('supervision.info.doTitle', 'supervision.info.doBody')}
        {section('supervision.info.sharedTitle', 'supervision.info.sharedBody')}
        {section('supervision.info.endTitle', 'supervision.info.endBody')}

        <Link
          to="/supervision-agreement"
          className="text-sm font-semibold text-red-600 hover:underline"
        >
          {t('supervision.info.agreementLink')}
        </Link>
      </div>
    </div>
  );
}
