import { useTranslation } from 'react-i18next';

// Placeholder stub — the real ID-upload verification page lands in Task 2.
export function VerificationPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('tutor.verificationTitle')}</h1>
    </main>
  );
}
