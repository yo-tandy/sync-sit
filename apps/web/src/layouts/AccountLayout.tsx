import { Link, Outlet } from 'react-router';
import { useDocumentGround } from '@ejm/shared-ui';
import { getSitRole } from '@ejm/sit-core';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/ui/PageContainer';
import { AuthGuard } from './AuthGuard';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { AppSwitchInlineHost } from '@/components/ui/AppSwitchInlineHost';
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
 * only wraps `<Outlet />`, below), titled "Sync/Account" -- centred via TWO
 * mechanisms, not one: at `md+` the two flanking slots are equal
 * `flex-1 basis-0` (not a fixed width: a `w-24` box clipped
 * `AppSwitchMenuItem`'s label onto three wrapped lines, caught on a
 * screenshot review of #484) and consume all the leftover space themselves;
 * below `md` both are `display:none`, so the header's OWN `justify-center`
 * is what centres the lone title (a regression caught on review of a1e5f12
 * -- without it, one flex child left-aligns by default). The Home link
 * keeps its own `hidden md:flex` `<nav>`; the right flank is a plain `<div>`
 * (not a `<nav>`) holding `AppSwitchInlineHost` (#417, plan Q9 answered):
 * the inline switcher renders its OWN `<nav aria-label=appSwitch.barLabel>`,
 * and nesting that inside an identically-labelled nav would give a
 * screen-reader user two "Switch app" landmarks for one control. Still the
 * only exit at `>=md`, since `AppSwitchBar` stays `md:hidden` -- that bar
 * carries the same label but is never in the accessibility tree at the
 * widths the inline switcher is. Neutral `bg-ground-admin`, the same token
 * stamped on `<html>` below -- never a brand colour -- and no bell, no menu
 * beyond the app switch: this layout owns no app's chrome.
 *
 * DESKTOP EXIT rationale (#416 review, updated #417/Q9): the exits live
 * here, in this layout only, rather than by unhiding the shared bar for all
 * six shells or by adding a back arrow -- a back arrow would frame the hub
 * as sitting underneath the portal you came from, which is exactly what
 * this layout exists to deny. Same destinations the phone bar offers, laid
 * out for desktop, and still neutral: grays only, no `--color-brand-*`.
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
        {/* justify-center: below `md` BOTH flanks are `display:none`, so the
            shrink-0 title is the header's only flex child and, without this,
            left-aligns instead of centring (caught on review of a1e5f12).
            At `md+` it is inert -- the two equal flex-1 flanks already
            consume all the leftover space themselves, so there is nothing
            left for justify-content to distribute -- but it is what centres
            the title on phone, where this header is ALSO now shown (#445). */}
        <header className="sticky top-0 z-40 flex h-12 items-center justify-center border-b border-gray-200 bg-ground-admin px-4">
          {/* Equal flex-1/basis-0 flanking slots (not a fixed w-24 -- that
              clipped `AppSwitchMenuItem`'s "Open sync-study" label onto
              three wrapped lines inside a 96px box, screenshot review on
              #484). Both grow/shrink identically regardless of content, so
              the shrink-0 title between them still centres on the FULL
              header width; the slots themselves absorb whatever space the
              title doesn't need. Both are empty (display:none) below `md`.
              The left flank is its own `<nav>` named "Home" (it holds only
              the Home link); the right flank is a plain `<div>` because the
              inline switcher inside it brings its own "Switch app" landmark
              (#417). The phone `AppSwitchBar` also carries that label but
              is `md:hidden`, so at no single breakpoint do two landmarks
              share a name. */}
          <nav
            aria-label={t('menu.home')}
            className="hidden flex-1 basis-0 items-center justify-start md:flex"
          >
            {portalHref && (
              <Link
                to={portalHref}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('menu.home')}
              </Link>
            )}
          </nav>
          <span className="shrink-0 text-center text-sm font-semibold text-gray-900">
            {t('accountHub.brandTitle')}
          </span>
          {/* Plain div, NOT a `<nav>`: `AppSwitchInlineHost` renders its own
              landmark (aria-label appSwitch.barLabel), and a nav nested in an
              identically-labelled nav is two landmarks for one control
              (#417). whitespace-nowrap stays on THIS wrapper so the pill
              labels never wrap inside the flank at the narrow end of `md`. */}
          <div className="hidden flex-1 basis-0 items-center justify-end whitespace-nowrap md:flex">
            <AppSwitchInlineHost accountHref="/account" homeHref={portalHref ?? '/'} />
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
