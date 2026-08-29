import { ReportProblemPage as SharedReportProblemPage } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
// From the shared constants rather than re-declared: this file held its own
// copy of both, which is exactly the drift brand.ts's docblock warns about
// (issue #115 -- the copy here outlived the address it named).
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
