import { Outlet } from 'react-router';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { PageContainer } from '@/components/ui/PageContainer';
import { ScrollToTop } from '@/components/ScrollToTop';

export function BabysitterLayout() {
  return (
    <AuthGuard role="babysitter">
      <div className="min-h-screen bg-white">
        <ScrollToTop />
        <AppBar role="babysitter" />
        {/* Desktop width cap (issue #119); wide pages opt out via data-page-width. */}
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </AuthGuard>
  );
}
