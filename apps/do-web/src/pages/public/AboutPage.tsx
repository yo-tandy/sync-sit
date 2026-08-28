import { useTranslation } from 'react-i18next';
import { AboutPageShell } from '@ejm/shared-ui';
import sitBrandMark from '@ejm/shared-ui/brand-marks/sync-sit.png';
import studyBrandMark from '@ejm/shared-ui/brand-marks/sync-study.png';
import { SIT_APP_URL, STUDY_APP_URL } from '@/utils/appSwitch';
import { SUPPORT_EMAIL } from '@/constants/brand';

/**
 * Minimal shell About page: logo, one-paragraph story, the sibling apps
 * (out-links — permitted direction under decision 20), and the support
 * address. Grows toward the siblings' full About pages with the product
 * (plan §13 PR7/PR8).
 */
export function AboutPage() {
  const { t } = useTranslation();

  return (
    <AboutPageShell title={t('about.title')}>
      <div className="px-6 pt-4 pb-8">
        {/* Logo + tagline */}
        <div className="mb-6 flex flex-col items-center">
          <img src="/logo.png" alt="Sync/Do" className="mb-3 h-24 w-24 rounded-2xl" />
          <p className="text-center text-sm text-gray-500">{t('about.tagline')}</p>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-gray-600">{t('about.story')}</p>

        {/* Sibling apps */}
        <h2 className="mb-3 text-lg font-bold text-gray-900">{t('about.siblingsTitle')}</h2>
        <p className="mb-3 text-sm leading-relaxed text-gray-600">{t('about.siblingsBody')}</p>
        <div className="mb-6 space-y-3">
          <a
            href={SIT_APP_URL}
            className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 transition-colors hover:bg-gray-100"
          >
            <img src={sitBrandMark} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
            <p className="text-sm font-semibold text-gray-900">Sync/Sit</p>
          </a>
          <a
            href={STUDY_APP_URL}
            className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 transition-colors hover:bg-gray-100"
          >
            <img src={studyBrandMark} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
            <p className="text-sm font-semibold text-gray-900">Sync/Study</p>
          </a>
        </div>

        {/* Contact */}
        <h2 className="mb-3 text-lg font-bold text-gray-900">{t('about.contactTitle')}</h2>
        <p className="text-sm leading-relaxed text-gray-600">
          {t('about.contactBody')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-500 hover:underline">{SUPPORT_EMAIL}</a>
        </p>
      </div>
    </AboutPageShell>
  );
}
