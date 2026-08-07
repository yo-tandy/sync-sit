import { useTranslation } from 'react-i18next';
import { TopNav } from '@ejm/shared-ui';

/** Per-kid oversight detail shell — surfaces land in the oversight task. */
export function GovernedChildPage() {
  const { t } = useTranslation();
  return (
    <div>
      <TopNav title={t('family.governance.title')} backTo="/family/governance" />
      <div className="px-5 pt-4 pb-8" />
    </div>
  );
}
