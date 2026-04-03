import { Outlet } from 'react-router';
import { ScrollToTop } from '@/components/ScrollToTop';

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-white">
      <ScrollToTop />
      <Outlet />
    </div>
  );
}
