import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui';

export function TermsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <TopNav title={t('menu.terms')} backTo="back" />
      <div className="px-6 pt-4">
        <h2 className="mb-4 text-xl font-bold">{t('menu.terms')}</h2>
        <p className="mb-4 text-sm leading-relaxed text-gray-500">
          Content to be provided before launch.
        </p>
        <p className="text-xs text-gray-400">Last updated: —</p>
      </div>
    </div>
  );
}
