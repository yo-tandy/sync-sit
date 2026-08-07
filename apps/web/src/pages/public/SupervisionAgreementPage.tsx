import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SUPERVISION_AGREEMENT_VERSION } from '@ejm/shared-core';
import { ArrowLeftIcon } from '@/components/ui/Icons';

/**
 * The Supervision Agreement — the third document of the consent trio. The EN
 * copy is AUTHORITATIVE from the governance plan (implemented verbatim in
 * i18n, byte-identical to sync-study's — parity-pinned by test); the version
 * heading comes from the shared-core constant so this page can never drift
 * from what createKidInvite/redeemKidInvite validate.
 */
export function SupervisionAgreementPage() {
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
        <span className="text-base font-semibold">{t('supervisionAgreement.title')}</span>
        <div className="w-9" />
      </div>

      <div className="px-6 py-8">
        <h1 className="mb-3 text-lg font-bold text-gray-900">{t('supervisionAgreement.title')}</h1>

        {/* Above the fold: which version this is and when it binds. */}
        <p className="mb-6 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          {t('supervisionAgreement.versionNote', { version: SUPERVISION_AGREEMENT_VERSION })}
        </p>

        <div className="mb-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">
            {t('supervisionAgreement.confirmTitle')}
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
            <li>{t('supervisionAgreement.confirmBullet1')}</li>
            <li>{t('supervisionAgreement.confirmBullet2')}</li>
          </ul>
        </div>

        {section('supervisionAgreement.seeTitle', 'supervisionAgreement.seeBody')}
        {section('supervisionAgreement.doTitle', 'supervisionAgreement.doBody')}
        {section(
          'supervisionAgreement.responsibilitiesTitle',
          'supervisionAgreement.responsibilitiesBody',
        )}
        {section('supervisionAgreement.sharingTitle', 'supervisionAgreement.sharingBody')}
        {section('supervisionAgreement.durationTitle', 'supervisionAgreement.durationBody')}
      </div>
    </div>
  );
}
