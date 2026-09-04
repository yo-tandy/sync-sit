import { Link, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getSitRole } from '@ejm/sit-core';
import { PageContainer } from '@/components/ui/PageContainer';
import { AuthGuard } from './AuthGuard';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { AppSwitchMenuItem } from '@/components/ui/AppSwitchMenuItem';
import { ScrollToTop } from '@/components/ScrollToTop';
import { useAuthStore } from '@/stores/authStore';

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
 *
 * DESKTOP EXIT (#416 review). `AppSwitchBar` is `md:hidden` by design -- the
 * other shells have NavTabs up there and where the switch belongs on desktop
 * is still open (plan Q9). That left this layout, which has no AppBar either,
 * with literally no navigation at all at >=md: you could reach the hub and not
 * leave it. So the exits are rendered here, in this layout only, rather than
 * by unhiding the shared bar for all six shells or by adding a back arrow --
 * a back arrow would frame the hub as sitting underneath the portal you came
 * from, which is exactly what this layout exists to deny. Same two
 * destinations the phone bar offers, laid out for desktop, and still neutral:
 * grays only, no `--color-brand-*`.
 */
export function AccountLayout() {
  const { t } = useTranslation();
  const userDoc = useAuthStore((s) => s.userDoc);
  // The member's own portal home. Mirrors AuthGuard's role redirects; a
  // signed-in member with no sit role has nowhere in sit to go back TO, so
  // the link is simply absent rather than pointing somewhere that bounces.
  const sitRole = userDoc ? getSitRole(userDoc) : null;
  const portalHref =
    sitRole === 'parent'
      ? '/family'
      : sitRole === 'babysitter'
        ? '/babysitter'
        : sitRole === 'admin'
          ? '/admin'
          : null;

  return (
    <AuthGuard>
      {/* pb-app-switch-bar reserves the fixed app-switch bar's height — the
          shared token (base.css, #419), row + safe-area inset. The bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-ground-admin pb-app-switch-bar md:pb-0">
        <ScrollToTop />
        <header className="hidden border-b border-gray-200 bg-white md:block">
          <nav
            aria-label={t('appSwitch.barLabel')}
            className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-2"
          >
            {portalHref ? (
              <Link
                to={portalHref}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('menu.home')}
              </Link>
            ) : (
              <span />
            )}
            <div className="w-auto text-sm">
              <AppSwitchMenuItem />
            </div>
          </nav>
        </header>
        <PageContainer>
          <Outlet />
        </PageContainer>
        {/* homeHref is the member's OWN portal, not '/': #385 requires the
            current-app tab to actually navigate, and the hub belongs to no
            portal, so it borrows the same role-aware target the desktop exit
            uses. '/' only for a member with no sit role, who has no portal. */}
        <AppSwitchBarHost accountHref="/account" homeHref={portalHref ?? '/'} />
      </div>
    </AuthGuard>
  );
}
