import { Outlet } from 'react-router';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { PageContainer } from '@/components/ui/PageContainer';
import { ScrollToTop } from '@/components/ScrollToTop';

export function BabysitterLayout() {
  return (
    <AuthGuard role="babysitter">
      {/* pb-16 clears the fixed app-switch bar on phones; the bar is md:hidden
          so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-white pb-16 md:pb-0">
        <ScrollToTop />
        <AppBar role="babysitter" />
        {/* Desktop width cap (issue #119); wide pages opt out via data-page-width. */}
        <PageContainer>
          <Outlet />
        </PageContainer>
        {/* The student's account lives at a different path than the parent's;
            the shared account hub (#367) is what collapses these to one. */}
        <AppSwitchBarHost accountHref="/babysitter/account" />
      </div>
    </AuthGuard>
  );
}
