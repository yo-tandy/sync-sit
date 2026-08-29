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
      <div className="min-h-screen bg-ground pb-16 md:pb-0">
        <ScrollToTop />
        <AppBar role="babysitter" />
        {/* Desktop width cap (issue #119); wide pages opt out via data-page-width. */}
        <PageContainer>
          <Outlet />
        </PageContainer>
        {/* The account tab now points at the SHARED hub (#367), not this
            portal's own account page: the babysitter's and the parent's used
            to be different paths, and collapsing them to one is the hub's
            whole purpose. homeHref stays this portal's own root (#385). */}
        <AppSwitchBarHost accountHref="/account" homeHref="/babysitter" />
      </div>
    </AuthGuard>
  );
}
