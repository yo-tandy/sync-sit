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
export interface AppSwitchEntryProps {
  current: SyncApp;
  currentMark: AppMark;
  siblings: ReadonlyArray<{ app: SyncApp; url: string; mark: AppMark }>;
  mintHandoffCode: () => Promise<string>;
  account?: { href: string; onNavigate: (href: string) => void };
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
  const [busyApp, setBusyApp] = useState<SyncApp | null>(null);
  const [failed, setFailed] = useState(false);

  const accountActive = account !== undefined && pathname === account.href;

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

  const switchTo = async (app: SyncApp, url: string) => {
    if (busyApp) return;
    setBusyApp(app);
    setFailed(false);
    try {
      const code = await mintHandoffCode();
      // Carry the CURRENT language across origins -- see AppSwitchBar's
      // docstring.
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

  const goAccount = () => {
    setFailed(false);
    if (account) account.onNavigate(account.href);
  };

  return { busyApp, failed, accountActive, appTabs, switchTo, goHome, goAccount };
}
