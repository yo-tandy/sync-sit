import { ReportProblemPage } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
import { BRAND, SUPPORT_EMAIL } from '@/constants/brand';

/**
 * Sit's report-a-problem page: the shared ReportProblemPage bound to this
 * app's brand, support address, and the signed-in user's uid. Lives in its
 * own module (not router.tsx) so the router file keeps exporting only
 * non-components -- react-refresh/only-export-components.
 */
export function SyncSitReportProblemPage() {
  const { userDoc } = useAuthStore();
  return <ReportProblemPage brand={BRAND} supportEmail={SUPPORT_EMAIL} userId={userDoc?.uid} />;
}
