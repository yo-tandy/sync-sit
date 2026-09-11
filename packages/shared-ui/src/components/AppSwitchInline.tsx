import { useTranslation } from 'react-i18next';
import { Spinner } from './Spinner.js';
import { APP_NAME } from '../lib/brandMarks.js';
import { AccountGlyph } from './AccountGlyph.js';
import { useAppSwitchState, type AppSwitchEntryProps } from './appSwitchShared.js';

export interface AppSwitchInlineProps extends AppSwitchEntryProps {
  /**
   * Which ground this renders on, since unlike the bottom bar (always its
   * own `bg-white` strip) this component is embedded directly into hosts
   * with two different grounds:
   *
   * - `'light'` (default) -- a white/neutral ground: the account hub header,
   *   the admin sidebar head. Gray text, `brand-50`/`gray-100` fills.
   * - `'onBrand'` -- each portal's own `bg-brand-*` top strip, next to the
   *   app name (sit/study/do's `AppBar`/`DoerAppBar`/`FamilyAppBar`). White
   *   text at reduced opacity, translucent white fills -- `bg-brand-50`
   *   would be invisible-to-illegible against a saturated brand background.
   */
  tone?: 'light' | 'onBrand';
}

/**
 * The desktop rendering of the app switch (plan Q9, issue #417): the SAME
 * entry set `AppSwitchBar` renders -- current app, siblings, "My account" --
 * from the SAME props, driven by the SAME handoff, as compact mark+label
 * pills in the top bar instead of a bottom tab row.
 *
 * `hidden md:flex` -- the exact inverse of `AppSwitchBar`'s `md:hidden`.
 * The two are mutually exclusive by breakpoint, which is what keeps this a
 * SECOND RENDERING of one entry point rather than a second entry point:
 * below `md` only the bar is in the a11y tree, at `md+` only this is. Every
 * host that used to leave the desktop switcher to the burger's
 * `AppSwitchMenuItem` row (§9.5's carve-out, kept only until Q9 landed)
 * removes that row now that this covers `md+` — see each host's own
 * AppBar/SideNav diff.
 *
 * Reuses `appSwitchShared.ts`'s `useAppSwitchState` for every mechanic that
 * isn't markup: the busy/failed handoff state, the bfcache un-stick effect,
 * the per-route failure reset, and the fixed suite-wide tab order (#438).
 * That is also where the decision-20 gate lives, structurally: this
 * component renders whatever `siblings` it is given and nothing else, so
 * sit/study omitting `do` from `siblings` (until #304) hides sync-do here
 * exactly as it does in the bar -- there is no separate list to keep in
 * sync.
 *
 * Same aria-label as `AppSwitchBar` (`appSwitch.barLabel`) -- safe only
 * because the two are never both in the accessibility tree at the same
 * viewport (see above); a host that renders both without the breakpoint
 * split would have two landmarks sharing one name.
 */
export function AppSwitchInline({
  current,
  currentMark,
  siblings,
  mintHandoffCode,
  account,
  pathname,
  home,
  tone = 'light',
}: AppSwitchInlineProps) {
  const { t } = useTranslation();
  const onBrand = tone === 'onBrand';
  const { busyApp, failed, accountActive, appTabs, switchTo, goHome, goAccount } = useAppSwitchState({
    current,
    currentMark,
    siblings,
    mintHandoffCode,
    account,
    pathname,
    home,
  });

  return (
    <nav aria-label={t('appSwitch.barLabel')} className="relative hidden items-center gap-1 md:flex">
      {/* Non-optimistic, like the bar: a failed mint leaves the switcher where
          it is, with a message, rather than pretending to navigate. Placed
          `top-full` (not `bottom-full`, unlike the bar's #419 overlay) --
          this switcher sits at the TOP of the page, so growing the row
          downward instead of into the brand bar above it is the equivalent
          placement, not a copy-paste of the bar's direction. */}
      {failed && (
        <p
          role="alert"
          className="absolute inset-x-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-error-600 shadow-sm"
        >
          {t('appSwitch.error')}
        </p>
      )}
      {appTabs.map(({ app, url, mark }) => {
        const isCurrent = app === current;
        const busy = busyApp === app;
        return (
          <button
            key={app}
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            disabled={busyApp !== null || (isCurrent && !home)}
            onClick={() => {
              if (isCurrent) {
                goHome();
                return;
              }
              if (url) void switchTo(app, url);
            }}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
              onBrand
                ? isCurrent
                  ? 'bg-white/20 text-white'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
                : isCurrent
                  ? 'bg-brand-50 text-brand-600'
                  : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {busy ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <img
                  src={mark.sm}
                  srcSet={`${mark.sm} 1x, ${mark.md} 2x`}
                  alt=""
                  width={16}
                  height={16}
                  className={`h-4 w-4 rounded object-contain ${isCurrent || onBrand ? '' : 'opacity-60'}`}
                />
              )}
            </span>
            <span>{APP_NAME[app]}</span>
          </button>
        );
      })}

      {account && (
        <button
          type="button"
          aria-current={accountActive ? 'page' : undefined}
          disabled={busyApp !== null}
          onClick={goAccount}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
            onBrand
              ? accountActive
                ? 'bg-white/20 text-white'
                : 'text-white/80 hover:bg-white/10 hover:text-white'
              : // Neutral, not branded: the account is shared and app-agnostic
                // (decision 24), so it must not wear the host app's colour.
                accountActive
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          <span className="flex h-4 w-4 items-center justify-center">
            <AccountGlyph className="h-3.5 w-3.5" />
          </span>
          <span>{t('appSwitch.account')}</span>
        </button>
      )}
    </nav>
  );
}
