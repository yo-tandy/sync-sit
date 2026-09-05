import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './Spinner.js';
import { APP_NAME, BRAND_MARKS, type SyncApp } from '../lib/brandMarks.js';

export interface AppSwitchBarProps {
  /** The app this bar is rendered inside. Its tab is active and never hands off. */
  current: SyncApp;
  /**
   * Sibling apps this bar offers, in display order, each with its origin.
   *
   * OMITTING AN APP HIDES ITS TAB, and that is the gate for sync/do: sit and
   * study pass only each other until #304 (decision 20) is approved. The
   * component takes no view on which apps are reachable -- reachability is a
   * product decision that lives in each app's shell, not in shared-ui.
   */
  siblings: ReadonlyArray<{ app: SyncApp; url: string }>;
  /**
   * Mints a one-time handoff code. Injected because shared-ui has no Firebase
   * of its own; each app passes a thin wrapper over its own callable.
   */
  mintHandoffCode: () => Promise<string>;
  /**
   * The account tab: where it goes within THIS app, and how to get there.
   *
   * OMIT IT AND THE TAB IS NOT RENDERED. sync-do has no account route by
   * design (platform plan §3 -- do-web ships no account page; the shared hub
   * owns identity and do contributes only a doer-settings screen), so until
   * the hub exists (#367) there is nowhere for that tab to go. A tab pointing
   * at a route that does not exist is worse than an absent one.
   *
   * ONE OBJECT, not an href plus a handler, so the two cannot be
   * half-supplied. An href without a handler renders a visible, enabled,
   * aria-current-capable tab that does nothing when tapped -- the same
   * failure the paragraph above argues against, reached from the other side.
   * Same reasoning that made `pathname` required: unforgettable beats
   * conventional (PR #385 round 4).
   */
  account?: { href: string; onNavigate: (href: string) => void };
  /**
   * The route currently on screen in THIS app.
   *
   * Required, and deliberately not optional, because the bar is PERSISTENT:
   * it lives in the layout outside `<Outlet />`, so it never unmounts and
   * cannot discover a route change on its own. Two things depend on it -- the
   * account tab's active state, and clearing a failed-switch message that
   * would otherwise stay pinned to the bottom of every screen for the rest of
   * the session. shared-ui stays router-free (no `useLocation` here), so the
   * shell supplies it; making it required is what stops a shell forgetting.
   */
  pathname: string;
  /**
   * The current app's own tab: its home route and how to get there. Paired
   * for the same reason `account` is.
   *
   * Omitting it makes that tab inert (rendered, disabled) -- which is a
   * legitimate state, but not one any shell ships: all six pass it, so the
   * tab navigates home like the tab bar it looks like.
   */
  home?: { href: string; onNavigate: (href: string) => void };
}

/**
 * The persistent bottom bar that switches APPS, not pages (plan §18.2,
 * decision 22; issue #365).
 *
 * Phone-only by design -- `md:hidden`. Desktop already has NavTabs and the
 * admin sidebar, and where the switch belongs there is still open (Q9), so
 * this deliberately renders nothing rather than guessing.
 *
 * That is why §9.5's burger-menu row is superseded ON PHONES ONLY. Each app
 * bar hides its `AppSwitchMenuItem` below `md` -- the same breakpoint, from
 * the other side -- so exactly one entry point exists at any width and the
 * whole-bar lock cannot be walked around via the burger. At `md+` the row is
 * still the only switcher there is, and it stays until Q9 is answered (#417).
 * sit's admin shell renders no bar at any width, so it keeps the row always.
 *
 * Switching a sibling is a CROSS-ORIGIN move today: mint a one-time code,
 * then navigate with it in the URL fragment (fragments never reach servers or
 * logs). That is why a tab shows a busy state instead of switching instantly
 * -- there is a redirect and a token redemption behind it. If the suite lands
 * on one origin under a paths-based domain (plan §18.9, Q12), the handoff
 * disappears and these become real instant tab switches; the component is
 * shaped so that change is a smaller one.
 *
 * Non-optimistic, like the menu row it supersedes: nothing navigates until
 * the mint resolves, and a failure leaves you where you are with a message.
 *
 * HEIGHT CONTRACT (#419). The bar's rendered height is exactly
 * `--spacing-app-switch-bar` (base.css): the tab row takes the row token as
 * an EXPLICIT height (`h-app-switch-row`) instead of being content-sized, and
 * the nav pads only the safe-area inset under it. Every shell that mounts the
 * bar reserves the same token (`pb-app-switch-bar md:pb-0`), so the bar and
 * the reservation cannot disagree the way fixed `pb-16` did against a
 * variable-height bar. The failed-switch alert deliberately OVERLAYS above
 * the nav (absolute, bottom-full) rather than rendering inside it — an
 * in-flow alert made the bar ~24px taller than any shell reserved, covering
 * content on every phone, safe-area inset or not.
 */
export function AppSwitchBar({
  current,
  siblings,
  mintHandoffCode,
  account,
  pathname,
  home,
}: AppSwitchBarProps) {
  const { t, i18n } = useTranslation();
  const [busyApp, setBusyApp] = useState<SyncApp | null>(null);
  const [failed, setFailed] = useState(false);

  const accountActive = account !== undefined && pathname === account.href;

  // The failure message belongs to ONE attempt, not to the session. This bar
  // never unmounts, so nothing else would ever take it down: a user whose
  // switch failed would carry the red line at the bottom of every screen
  // until they happened to try again. Any route change ends the attempt.
  //
  // Adjusted DURING RENDER rather than in an effect -- React's documented
  // "resetting state when a prop changes" shape. An effect would paint the
  // stale message once on the new route and then re-render, and
  // react-hooks/set-state-in-effect rejects it.
  const [renderedAt, setRenderedAt] = useState(pathname);
  if (renderedAt !== pathname) {
    setRenderedAt(pathname);
    setFailed(false);
  }

  // Staying busy through the cross-origin navigation is correct -- but the
  // page can come BACK with that state intact when the browser restores it
  // from bfcache (back button). `disabled={busyApp !== null}` covers every
  // tab, so a restored page would show a permanently dead bar until reload.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setBusyApp(null);
      setFailed(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const switchTo = async (app: SyncApp, url: string) => {
    if (busyApp) return;
    setBusyApp(app);
    setFailed(false);
    try {
      const code = await mintHandoffCode();
      // Carry the CURRENT language across origins: i18n caches are per-origin
      // localStorage, so without this the sibling opens in whatever language
      // it last saw. Whitelisted here to mirror the receiver's en|fr allowlist.
      const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
      window.location.assign(
        `${url}/handoff#code=${encodeURIComponent(code)}&lang=${encodeURIComponent(lang)}`,
      );
      // Stay busy: the browser is navigating away.
    } catch {
      setFailed(true);
      setBusyApp(null);
    }
  };

  // The current app first, then its siblings in the order given, then account.
  const appTabs: ReadonlyArray<{ app: SyncApp; url?: string }> = [
    { app: current },
    ...siblings.filter((s) => s.app !== current),
  ];

  return (
    <nav
      aria-label={t('appSwitch.barLabel')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {/* OVERLAY, not in-flow (#419): rendered inside the nav's box this
          alert grew the bar past the height every shell reserves, covering
          ~17px of page content on any phone while it showed. bottom-full
          floats it just above the nav (the fixed nav is its containing
          block), so the bar's height stays the constant the shells' token
          padding is matched to. It needs its own ground and top border for
          the same reason — it now sits over page content, not bar chrome.
          Transient by design: cleared on route change, another tab, a fresh
          attempt, and bfcache restore (see the `failed` state above). */}
      {failed && (
        <p
          role="alert"
          className="absolute inset-x-0 bottom-full border-t border-gray-200 bg-white px-4 py-2 text-center text-xs text-error-600"
        >
          {t('appSwitch.error')}
        </p>
      )}
      {/* focus-ring-inset: these tabs sit flush against the viewport's bottom
          and side edges, so the shared WCAG 2.4.7 ring (outline-offset 2px +
          a 2px white backing, base.css) would paint ~4px OUTSIDE the viewport
          and simply not render for the bottom row and the end tabs. Drawing
          it inside keeps the indicator visible. The ground is bg-white, which
          is that class's documented light-ground constraint.

          h-app-switch-row: the EXPLICIT height half of the #419 contract —
          content no longer sizes the row, the shared token does, so the bar's
          total height is exactly the --spacing-app-switch-bar every shell
          reserves. items-stretch only stretches the <li> flex items to that
          height, not the plain in-flow <button> inside each one — so every
          button also carries h-full, and centers its icon+label column
          inside the row rather than inside its own content-sized box. */}
      <ul className="focus-ring-inset flex h-app-switch-row items-stretch">
        {appTabs.map(({ app, url }) => {
          const isCurrent = app === current;
          const busy = busyApp === app;
          const mark = BRAND_MARKS[app];
          return (
            <li key={app} className="flex-1">
              <button
                type="button"
                aria-current={isCurrent ? 'page' : undefined}
                disabled={busyApp !== null || (isCurrent && !home)}
                onClick={() => {
                  if (isCurrent) {
                    // Clear here as well as on route change: tapping home while
                    // already home navigates nowhere, so the pathname effect
                    // above never fires and the message would outlive the
                    // interaction that was meant to end it.
                    setFailed(false);
                    if (home) home.onNavigate(home.href);
                    return;
                  }
                  if (url) void switchTo(app, url);
                }}
                className={`flex h-full w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors ${
                  isCurrent ? 'text-brand-600' : 'text-gray-500 active:bg-gray-50'
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center">
                  {busy ? (
                    <Spinner className="h-5 w-5" />
                  ) : (
                    <img
                      src={mark.sm}
                      srcSet={`${mark.sm} 1x, ${mark.md} 2x`}
                      alt=""
                      width={24}
                      height={24}
                      className={`h-6 w-6 rounded object-contain ${isCurrent ? '' : 'opacity-60'}`}
                    />
                  )}
                </span>
                <span className="truncate">{APP_NAME[app]}</span>
              </button>
            </li>
          );
        })}

        {account && (
        <li className="flex-1">
          <button
            type="button"
            aria-current={accountActive ? 'page' : undefined}
            disabled={busyApp !== null}
            onClick={() => {
              setFailed(false);
              account.onNavigate(account.href);
            }}
            className={`flex h-full w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors ${
              // Neutral, not branded: the account is shared and app-agnostic
              // (decision 24), so it must not wear the host app's colour.
              accountActive ? 'text-gray-900' : 'text-gray-500 active:bg-gray-50'
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center">
              <AccountGlyph className="h-5 w-5" />
            </span>
            <span className="truncate">{t('appSwitch.account')}</span>
          </button>
        </li>
        )}
      </ul>
    </nav>
  );
}

function AccountGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" />
    </svg>
  );
}
