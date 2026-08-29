import { ReportProblemPage as SharedReportProblemPage } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
// One constant, not a local literal: the duplicate here is exactly the drift
// brand.ts warns about, and it kept a bouncing address alive after the
// constant was corrected (#349).
import { BRAND, SUPPORT_EMAIL } from '@/constants/brand';

/**
 * Sync/Study wrapper around the shared ReportProblemPage — binds the brand,
 * support email, and the signed-in user's id. Lives in its own file so router.tsx
 * carries no component definitions (route-level lazy() split + react-refresh).
 */
export function ReportProblemPage() {
  const { userDoc } = useAuthStore();
  return <SharedReportProblemPage brand={BRAND} supportEmail={SUPPORT_EMAIL} userId={userDoc?.uid} />;
}
