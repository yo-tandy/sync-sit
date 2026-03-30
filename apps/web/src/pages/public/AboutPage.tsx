import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui';

export function AboutPage() {
  const { t } = useTranslation();

  return (
    <div>
      <TopNav title={t('about.title')} backTo="back" />
      <div className="px-6 pt-4">
        <div className="mb-6 flex justify-center">
          <img src="/logo.png" alt="Sync/Sit" className="h-24 w-24 rounded-2xl" />
        </div>
        <h2 className="mb-4 text-xl font-bold">{t('about.heading')}</h2>
        <p className="mb-4 text-sm leading-relaxed text-gray-600">
          {t('about.body1')}
        </p>
        <p className="mb-4 text-sm leading-relaxed text-gray-600">
          {t('about.body2')}
        </p>
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">Version 1.0.0</p>
        </div>
      </div>
    </div>
  );
}
