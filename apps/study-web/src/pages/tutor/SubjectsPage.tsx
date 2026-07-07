import { useTranslation } from 'react-i18next';

// Placeholder stub — the real subjects & rates editor lands in Task 4.
export function SubjectsPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('tutor.subjectsTitle')}</h1>
    </main>
  );
}
