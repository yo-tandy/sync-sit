import { useTranslation } from 'react-i18next';
import { AboutPageShell } from '@ejm/shared-ui';

export function AboutPage() {
  const { t } = useTranslation();
  return (
    <AboutPageShell title={t('about.title')}>
      <div className="px-6 pt-4 pb-8">
        <h1 className="mb-3 text-xl font-bold text-gray-900">
          {t('about.heading')}
        </h1>
        <p className="mb-4 text-sm leading-relaxed text-gray-700">{t('about.body1')}</p>
        <p className="mb-4 text-sm leading-relaxed text-gray-700">{t('about.body2')}</p>
      </div>
    </AboutPageShell>
  );
}
