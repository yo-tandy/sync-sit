import { useTranslation } from 'react-i18next';

// Placeholder stub — the real verification-state-aware dashboard lands in Task 3.
export function DashboardPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('tutor.dashboardTitle')}</h1>
    </main>
  );
}
