import { ReportProblemPage as SharedReportProblemPage } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
import { BRAND, SUPPORT_EMAIL } from '@/constants/brand';

/**
 * Sync/Do wrapper around the shared ReportProblemPage — binds the brand,
 * support email, and the signed-in user's id. Lives in its own file so
 * router.tsx carries no component definitions (route-level lazy() split +
 * react-refresh), mirroring study-web.
 */
export function ReportProblemPage() {
  const { userDoc } = useAuthStore();
  return <SharedReportProblemPage brand={BRAND} supportEmail={SUPPORT_EMAIL} userId={userDoc?.uid} />;
}
