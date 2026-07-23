import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { FamilyAppBar } from '@/components/ui/FamilyAppBar';
import { ScrollToTop } from '@/components/ScrollToTop';

/**
 * Family portal shell. Mirrors TutorLayout, guarded on role="parent" with its
 * own FamilyAppBar (chrome is intentionally duplicated per portal).
 */
export function FamilyLayout() {
  return (
    <AuthGuard role="parent">
      <div className="min-h-screen bg-white">
        <ScrollToTop />
        <FamilyAppBar />
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
