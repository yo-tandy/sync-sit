import { useTranslation } from 'react-i18next';

// "Coming soon" stub — the real tutor-search page ships in PR C, which replaces
// this component in the router.
export function SearchPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('family.searchTitle')}</h1>
      <p className="mt-2 text-sm text-gray-500">{t('common.comingSoon')}</p>
    </main>
  );
}
