import { useTranslation } from 'react-i18next';

// Placeholder stub — the real schedule editor lands in Task 5.
export function SchedulePage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('tutor.scheduleTitle')}</h1>
    </main>
  );
}
