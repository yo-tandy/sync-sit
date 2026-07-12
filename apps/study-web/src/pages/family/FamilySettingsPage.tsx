import { useTranslation } from 'react-i18next';

// Placeholder stub — family name/address edit + kids CRUD land in Task 3.
export function FamilySettingsPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('family.settingsTitle')}</h1>
    </main>
  );
}
