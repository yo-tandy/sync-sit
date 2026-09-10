import { Link, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useDocumentGround } from '@ejm/shared-ui';
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
 * NO BACK BUTTON either: the header below carries no back affordance, and
 * `AccountHome` renders no TopNav with `backTo`. A back arrow would frame
 * the account as sitting underneath the app you arrived from. It sits
 * beside them. The bottom bar is how you leave (on phone); the header's own
 * Home link is how you leave on desktop (below).
 *
 * The ground is the NEUTRAL one, not the app's tint, for the same reason.
 *
 * NOT role-scoped: `AuthGuard` here only requires a signed-in member. Both a
 * parent and a student reach the same hub -- what differs is which rows it
 * shows, which is the host's job, not the guard's.
 *
 * ONE HEADER, OWNED HERE (#445 review). This used to be a `hidden md:block`
 * desktop-only exit bar (Home link + app-switch menu), while `AccountHome`
 * separately rendered its own ALWAYS-visible sticky "Sync/Account" banner at
 * the same `z-40` -- which painted over this one at `md+`, since both are
 * full-bleed and stacked at the same position. There can only be one header,
 * so this is now it, at every breakpoint: `sticky top-0 z-40 h-12`,
 * full-bleed because this layout sits OUTSIDE `PageContainer` (the width cap
 * only wraps `<Outlet />`, below), titled "Sync/Account" -- centred at every
 * width via the two flanking slots being equal `flex-1 basis-0` (not a fixed
 * width: a `w-24` box clipped `AppSwitchMenuItem`'s label onto three wrapped
 * lines, caught on a screenshot review of #484) and empty when hidden. The
 * Home link and app-switch menu are UNCHANGED in substance, just now
 * `hidden md:flex` instead of the old `hidden md:block` on the whole header --
 * still the only exit at `>=md`, since `AppSwitchBar` stays `md:hidden`
 * (plan Q9 is still open on where the switch belongs at desktop). Neutral
 * `bg-ground-admin`, the same token stamped on `<html>` below -- never a
 * brand colour -- and no bell, no menu beyond the app switch: this layout
 * owns no app's chrome.
 */
export function AccountLayout() {
  const { t } = useTranslation();
  // Ground reaches html too (#424) — the NEUTRAL one, matching the shell's
  // bg-ground-admin above: iOS overscroll + the AuthGuard resolve state
  // paint the canvas, which no descendant div can tint.
  useDocumentGround('admin');
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
        {/* The hub's ONE header, every breakpoint -- see the docstring above.
            `sticky` (not `fixed`) is enough here, unlike inside `AccountHome`:
            this layout already sits outside `PageContainer`, so `sticky`'s
            normal-flow containing block is already full width. */}
        <header className="sticky top-0 z-40 flex h-12 items-center border-b border-gray-200 bg-ground-admin px-4">
          {/* Equal flex-1/basis-0 flanking slots (not a fixed w-24 -- that
              clipped `AppSwitchMenuItem`'s "Open sync-study" label onto
              three wrapped lines inside a 96px box, screenshot review on
              #484). Both grow/shrink identically regardless of content, so
              the shrink-0 title between them still centres on the FULL
              header width; the slots themselves absorb whatever space the
              title doesn't need. Both are empty (display:none) below `md`. */}
          <div className="hidden flex-1 basis-0 items-center justify-start md:flex">
            {portalHref && (
              <Link
                to={portalHref}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('menu.home')}
              </Link>
            )}
          </div>
          <span className="shrink-0 text-center text-sm font-semibold text-gray-900">
            {t('accountHub.brandTitle')}
          </span>
          {/* whitespace-nowrap lives on THIS wrapper, not inside
              `AppSwitchMenuItem` itself -- that component is also rendered
              full-width inside `AppBar`'s burger menu (phone width, plenty
              of room), and `white-space` inherits down to its label without
              needing to touch that shared component's own markup. */}
          <div className="hidden flex-1 basis-0 items-center justify-end whitespace-nowrap md:flex">
            <AppSwitchMenuItem />
          </div>
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
