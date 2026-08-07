import { useTranslation } from 'react-i18next';
import { TopNav } from '@ejm/shared-ui';

/** Family governance dashboard shell — surfaces land in the dashboard task. */
export function GovernancePage() {
  const { t } = useTranslation();
  return (
    <div>
      <TopNav title={t('family.governance.title')} backTo="/family" />
      <div className="px-5 pt-4 pb-8" />
    </div>
  );
}
