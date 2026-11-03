import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_ORDER, type AppMark, type SyncApp } from '../lib/brandMarks.js';

/**
 * The prop contract shared by `AppSwitchBar` (phone, `md:hidden`) and
 * `AppSwitchInline` (desktop, `hidden md:flex`) -- issue #417 (plan Q9): the
 * same entries, the same host-supplied marks, the same handoff, rendered two
 * ways at two mutually exclusive breakpoints. Extracted here so a prop this
 * shape means the same thing in both places rather than two docstrings
 * drifting apart. See `AppSwitchBar`'s docstring for the shape's own
 * rationale (decision 22, #365) -- it is not repeated per field here.
 */
/**
 * The suite's ONE account hub: a route on sync-sit (owner decision -- one
 * hub, one origin). sit's tab navigates here in-app; study and do hand off to
 * sync-sit with this as `next`, which sit's HandoffPage allow-lists.
 */
export const ACCOUNT_HUB_PATH = '/account';

/**
 * The account tab's destination. The suite has ONE account hub, hosted on
 * sync-sit at `/account`, so the tab takes one of two forms:
 *
 * - IN-APP (`onNavigate`): the hub is a route in THIS app (sync-sit). The tab
 *   navigates there and is `aria-current` while it is on screen.
 * - HANDOFF (`handoffUrl`): the hub lives on another app's origin (study and
 *   do pass sync-sit's URL). The tab mints a handoff code and leaves for
 *   `${handoffUrl}/handoff#…&next=<href>`, with the same busy/failed
 *   handling as the app tabs. Never `aria-current`: the hub is never on
 *   screen in the app that renders this form.
 *
 * A union, not optional fields, so a host cannot half-supply either form.
 */
export type AppSwitchAccount =
  | { href: string; onNavigate: (href: string) => void; handoffUrl?: never }
  | { href: string; handoffUrl: string; onNavigate?: never };

export interface AppSwitchEntryProps {
  current: SyncApp;
  currentMark: AppMark;
  siblings: ReadonlyArray<{ app: SyncApp; url: string; mark: AppMark }>;
  mintHandoffCode: () => Promise<string>;
  account?: AppSwitchAccount;
  pathname: string;
  home?: { href: string; onNavigate: (href: string) => void };
}

/**
 * The state and handoff mechanics shared by `AppSwitchBar` and
 * `AppSwitchInline` -- everything except the markup. Both components render
 * the SAME entry set from the SAME props (#417), and until this hook existed
 * that meant the busy/failed state machine, the bfcache un-stick effect, the
 * per-route failure reset and the fixed-order tab list were two copies that
 * could silently drift. One copy now; each component supplies only its own
 * JSX.
 */
export function useAppSwitchState({
  current,
  currentMark,
  siblings,
  mintHandoffCode,
  account,
  pathname,
  home,
}: AppSwitchEntryProps) {
  const { i18n } = useTranslation();
  // 'account' while the account tab's own handoff is in flight.
  const [busyApp, setBusyApp] = useState<SyncApp | 'account' | null>(null);
  const [failed, setFailed] = useState(false);

  const accountActive =
    account !== undefined && account.handoffUrl === undefined && pathname === account.href;

  // The failure message belongs to ONE attempt, not to the session -- see
  // AppSwitchBar's docstring for why this runs during render rather than in
  // an effect.
  const [renderedAt, setRenderedAt] = useState(pathname);
  if (renderedAt !== pathname) {
    setRenderedAt(pathname);
    setFailed(false);
  }

  // bfcache restore can bring the page back mid-navigation with `busyApp`
  // still set -- see AppSwitchBar's docstring.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setBusyApp(null);
      setFailed(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // One mint-and-leave for every cross-origin entry: the app tabs (no
  // `next`, landing on the target's post-login route) and the handoff-form
  // account tab (`next` = the hub's path, re-validated by the receiver).
  const handOff = async (key: SyncApp | 'account', url: string, next?: string) => {
    if (busyApp) return;
    setBusyApp(key);
    setFailed(false);
    try {
      const code = await mintHandoffCode();
      // Carry the CURRENT language across origins -- see AppSwitchBar's
      // docstring.
      const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
      const nextParam = next ? `&next=${encodeURIComponent(next)}` : '';
      window.location.assign(
        `${url}/handoff#code=${encodeURIComponent(code)}&lang=${encodeURIComponent(lang)}${nextParam}`,
      );
      // Stay busy: the browser is navigating away.
    } catch {
      setFailed(true);
      setBusyApp(null);
    }
  };

  // Fixed suite-wide order (#438) -- NOT current-first. See AppSwitchBar's
  // docstring.
  const siblingByApp = new Map(siblings.map((s) => [s.app, s]));
  const appTabs: ReadonlyArray<{ app: SyncApp; url?: string; mark: AppMark }> = APP_ORDER.filter(
    (app) => app === current || siblingByApp.has(app),
  ).map((app) =>
    app === current
      ? { app, url: undefined, mark: currentMark }
      : { app, url: siblingByApp.get(app)!.url, mark: siblingByApp.get(app)!.mark },
  );

  const goHome = () => {
    // Clear here as well as on route change: tapping home while already
    // home navigates nowhere, so the pathname effect above never fires.
    setFailed(false);
    if (home) home.onNavigate(home.href);
  };

  const switchTo = (app: SyncApp, url: string) => handOff(app, url);

  const goAccount = () => {
    if (!account) return;
    if (account.handoffUrl !== undefined) {
      void handOff('account', account.handoffUrl, account.href);
      return;
    }
    setFailed(false);
    account.onNavigate(account.href);
  };

  return { busyApp, failed, accountActive, appTabs, switchTo, goHome, goAccount };
}
