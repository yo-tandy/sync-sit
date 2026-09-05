import { Outlet } from 'react-router';
import { useDocumentGround } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { PageContainer } from '@/components/ui/PageContainer';
import { ScrollToTop } from '@/components/ScrollToTop';

export function FamilyLayout() {
  // Ground reaches html too (#424): iOS overscroll + the AuthGuard resolve
  // state paint the canvas, which no descendant div can tint.
  useDocumentGround('app');
  return (
    <AuthGuard role="parent">
      {/* pb-app-switch-bar reserves the fixed app-switch bar's height — the
          shared token (base.css, #419), row + safe-area inset, so a
          home-indicator device gets the taller reservation the bar actually
          renders. The bar is md:hidden, so the padding lifts at the same
          breakpoint. Without it the last row of every scrolled page sits
          underneath the bar. */}
      <div className="min-h-screen bg-ground pb-app-switch-bar md:pb-0">
        <ScrollToTop />
        <AppBar role="parent" />
        {/* Desktop width cap (issue #119); wide pages opt out via data-page-width. */}
        <PageContainer>
          <Outlet />
        </PageContainer>
        {/* Account tab -> the SHARED hub (#367); home stays this portal (#385). */}
        <AppSwitchBarHost accountHref="/account" homeHref="/family" />
      </div>
    </AuthGuard>
  );
}
