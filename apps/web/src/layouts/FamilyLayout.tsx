import { Outlet } from 'react-router';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { PageContainer } from '@/components/ui/PageContainer';
import { ScrollToTop } from '@/components/ScrollToTop';

export function FamilyLayout() {
  return (
    <AuthGuard role="parent">
      {/* pb-16 on phones clears the fixed app-switch bar; the bar is md:hidden,
          so the padding lifts at the same breakpoint. Without it the last row
          of every scrolled page sits underneath the bar. */}
      <div className="min-h-screen bg-white pb-16 md:pb-0">
        <ScrollToTop />
        <AppBar role="parent" />
        {/* Desktop width cap (issue #119); wide pages opt out via data-page-width. */}
        <PageContainer>
          <Outlet />
        </PageContainer>
        <AppSwitchBarHost accountHref="/family/account" />
      </div>
    </AuthGuard>
  );
}
