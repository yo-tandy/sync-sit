import { Outlet } from 'react-router';
import { PageContainer } from '@/components/ui/PageContainer';
import { AuthGuard } from './AuthGuard';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { ScrollToTop } from '@/components/ScrollToTop';

/**
 * Shell for the shared account hub (#367, decision 24).
 *
 * ITS OWN LAYOUT, not FamilyLayout or BabysitterLayout, and that is the
 * structural half of "the account is shared, not a subsection of whichever
 * app you opened". Both of those render `AppBar`, which is `bg-brand-600` --
 * so hosting the hub inside either would put sit's red (or study's blue)
 * across the top of a page that is meant to belong to no app in particular.
 * Here there is no AppBar at all.
 *
 * NO BACK BUTTON either: the hub renders no TopNav with `backTo`. A back
 * arrow would frame the account as sitting underneath the app you arrived
 * from. It sits beside them. The bottom bar is how you leave.
 *
 * The ground is the NEUTRAL one, not the app's tint, for the same reason.
 *
 * NOT role-scoped: `AuthGuard` here only requires a signed-in member. Both a
 * parent and a student reach the same hub -- what differs is which rows it
 * shows, which is the host's job, not the guard's.
 */
export function AccountLayout() {
  return (
    <AuthGuard>
      {/* pb-16 clears the fixed app-switch bar on phones; the bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-ground-admin pb-16 md:pb-0">
        <ScrollToTop />
        <PageContainer>
          <Outlet />
        </PageContainer>
        <AppSwitchBarHost accountHref="/account" homeHref="/" />
      </div>
    </AuthGuard>
  );
}
