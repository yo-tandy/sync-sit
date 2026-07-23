import { ReportProblemPage as SharedReportProblemPage } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';

const SUPPORT_EMAIL = 'support@sync-study.com';
const BRAND = 'Sync/Study';

/**
 * Sync/Study wrapper around the shared ReportProblemPage — binds the brand,
 * support email, and the signed-in user's id. Lives in its own file so router.tsx
 * carries no component definitions (route-level lazy() split + react-refresh).
 */
export function ReportProblemPage() {
  const { userDoc } = useAuthStore();
  return <SharedReportProblemPage brand={BRAND} supportEmail={SUPPORT_EMAIL} userId={userDoc?.uid} />;
}
