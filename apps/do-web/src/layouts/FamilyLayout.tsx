import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { FamilyAppBar } from '@/components/ui/FamilyAppBar';

/**
 * Family portal shell (plan §13 PR7) — study-web's FamilyLayout shape:
 * guard on role="parent", the portal's own app bar, and the desktop width
 * cap around a Suspense'd Outlet.
 */
export function FamilyLayout() {
  return (
    <AuthGuard role="parent">
      <div className="min-h-screen bg-white">
        <FamilyAppBar />
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
