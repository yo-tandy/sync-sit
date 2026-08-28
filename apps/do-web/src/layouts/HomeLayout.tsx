import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';

/**
 * Layout for the authenticated shell — study-web's TutorLayout shape (guard
 * around chrome around a Suspense'd Outlet), minus the AppBar: the shell's
 * only page carries its own minimal header, and the real portal chrome
 * arrives with the portal PRs (plan §13 PR7/PR8).
 */
export function HomeLayout() {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-white">
        <Suspense
          fallback={
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </AuthGuard>
  );
}
