import { ReportProblemPage } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';

// Lives outside router.tsx so that file only exports non-components + the
// router object; a component defined there trips
// react-refresh/only-export-components (lint was red on main).
const SUPPORT_EMAIL = 'support@sync-sit.com';
const BRAND = 'Sync/Sit';

export function SyncSitReportProblemPage() {
  const { userDoc } = useAuthStore();
  return <ReportProblemPage brand={BRAND} supportEmail={SUPPORT_EMAIL} userId={userDoc?.uid} />;
}
