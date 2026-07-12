import { useTranslation } from 'react-i18next';

// Placeholder stub — the real account editor lands in Task 3.
export function AccountPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('family.accountTitle')}</h1>
    </main>
  );
}
