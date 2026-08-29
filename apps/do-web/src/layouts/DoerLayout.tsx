import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { DoerAppBar } from '@/components/ui/DoerAppBar';

/**
 * Doer portal shell (plan §13 PR8) — FamilyLayout's shape: guard on
 * role="doer" (admins pass through, see AuthGuard), the portal's own app
 * bar, and the desktop width cap around a Suspense'd Outlet. Replaces the
 * PR2 placeholder HomeLayout: the board at /doer/board IS the app's home screen
 * (plan §9.2).
 */
export function DoerLayout() {
  return (
    <AuthGuard role="doer">
      <div className="min-h-screen bg-white">
        <DoerAppBar />
        <PageContainer>
          <Suspense
            fallback={
              <div className="flex justify-center py-20">
                <Spinner />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </PageContainer>
      </div>
    </AuthGuard>
  );
}
