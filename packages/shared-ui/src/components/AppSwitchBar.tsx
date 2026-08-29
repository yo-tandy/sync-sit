import { useState } from 'react';
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
  /** Where the account tab goes within THIS app. */
  accountHref: string;
  /** True when the account view is the one on screen. */
  accountActive?: boolean;
  /** Same-origin navigation for the account tab (router push). */
  onNavigateAccount: (href: string) => void;
  /** Where the current app's own tab goes when tapped. Omit to make it inert. */
  homeHref?: string;
  onNavigateHome?: (href: string) => void;
}

/**
 * The persistent bottom bar that switches APPS, not pages (plan §18.2,
 * decision 22; issue #365).
 *
 * Phone-only by design -- `md:hidden`. Desktop already has NavTabs and the
 * admin sidebar, and where the switch belongs there is still open (Q9), so
 * this deliberately renders nothing rather than guessing.
 *
 * Switching a sibling is a CROSS-ORIGIN move today: mint a one-time code,
 * then navigate with it in the URL fragment (fragments never reach servers or
 * logs). That is why a tab shows a busy state instead of switching instantly
 * -- there is a redirect and a token redemption behind it. If the suite lands
 * on one origin under a paths-based domain (plan §18.9, Q12), the handoff
 * disappears and these become real instant tab switches; the component is
 * shaped so that change is a smaller one.
 *
 * Non-optimistic, like the menu item it replaces: nothing navigates until the
 * mint resolves, and a failure leaves you where you are with a message.
 */
export function AppSwitchBar({
  current,
  siblings,
  mintHandoffCode,
  accountHref,
  accountActive = false,
  onNavigateAccount,
  homeHref,
  onNavigateHome,
}: AppSwitchBarProps) {
  const { t, i18n } = useTranslation();
  const [busyApp, setBusyApp] = useState<SyncApp | null>(null);
  const [failed, setFailed] = useState(false);

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
      {failed && (
        <p role="alert" className="px-4 pt-2 text-center text-xs text-error-600">
          {t('appSwitch.error')}
        </p>
      )}
      <ul className="flex items-stretch">
        {appTabs.map(({ app, url }) => {
          const isCurrent = app === current;
          const busy = busyApp === app;
          const mark = BRAND_MARKS[app];
          return (
            <li key={app} className="flex-1">
              <button
                type="button"
                aria-current={isCurrent ? 'page' : undefined}
                disabled={busyApp !== null || (isCurrent && !homeHref)}
                onClick={() => {
                  if (isCurrent) {
                    if (homeHref && onNavigateHome) onNavigateHome(homeHref);
                    return;
                  }
                  if (url) void switchTo(app, url);
                }}
                className={`flex w-full flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors ${
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

        <li className="flex-1">
          <button
            type="button"
            aria-current={accountActive ? 'page' : undefined}
            disabled={busyApp !== null}
            onClick={() => onNavigateAccount(accountHref)}
            className={`flex w-full flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors ${
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
