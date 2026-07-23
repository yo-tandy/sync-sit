import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { Spinner } from '@ejm/shared-ui';

export function PublicLayout() {
  return (
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
  );
}
