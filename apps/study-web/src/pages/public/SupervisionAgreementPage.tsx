import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '@ejm/shared-ui';

/** Supervision Agreement shell — the agreement copy lands in its own task. */
export function SupervisionAgreementPage() {
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
        <span className="text-base font-semibold">{t('supervisionAgreement.title')}</span>
        <div className="w-9" />
      </div>
      <div className="px-6 py-8" />
    </div>
  );
}
