import { Outlet } from 'react-router';
import { useDocumentGround } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { PageContainer } from '@/components/ui/PageContainer';
import { ScrollToTop } from '@/components/ScrollToTop';

export function BabysitterLayout() {
  // Ground reaches html too (#424): iOS overscroll + the AuthGuard resolve
  // state paint the canvas, which no descendant div can tint.
  useDocumentGround('app');
  return (
    <AuthGuard role="babysitter">
      {/* pb-app-switch-bar reserves the fixed app-switch bar's height — the
          shared token (base.css, #419), row + safe-area inset. The bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-ground pb-app-switch-bar md:pb-0">
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
