import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

const h = vi.hoisted(() => ({ assign: vi.fn() }));

import i18n from '@/i18n';
import { AppSwitchBar } from '@ejm/shared-ui';

/**
 * Contract tests for the shared bottom app-switch bar (issue #365, plan
 * §18.2). Lives in apps/web because shared-ui has no test harness of its own
 * (#348) -- the component under test is shared, the runner is sit's.
 */
const SIBLINGS = [
  { app: 'study' as const, url: 'https://sync-study-app.web.app' },
  { app: 'do' as const, url: 'https://sync-do-app.web.app' },
];

/**
 * The DEFAULT here mirrors what every shipped shell passes -- `account` and
 * `home` both supplied -- so a test that overrides neither is exercising a
 * production configuration. sit's babysitter/parent shells and study's two
 * pass both; do passes `home` only, which the omit-account test covers.
 */
function renderBar(props: Partial<React.ComponentProps<typeof AppSwitchBar>> = {}) {
  const mint = props.mintHandoffCode ?? vi.fn().mockResolvedValue('code123');
  const onNavigateAccount = props.account?.onNavigate ?? vi.fn();
  const onNavigateHome = props.home?.onNavigate ?? vi.fn();
  const bar = (pathname: string) => (
    <I18nextProvider i18n={i18n}>
      <AppSwitchBar
        current="sit"
        siblings={SIBLINGS.slice(0, 1)}
        mintHandoffCode={mint}
        account={{ href: '/family/account', onNavigate: onNavigateAccount }}
        home={{ href: '/family', onNavigate: onNavigateHome }}
        pathname={pathname}
        {...props}
      />
    </I18nextProvider>
  );
  const { rerender } = render(bar('/family'));
  /** Re-render at a new route, the way the shell's useLocation would. */
  const navigateTo = (pathname: string) => rerender(bar(pathname));
  return { mint, onNavigateAccount, onNavigateHome, navigateTo };
}

describe('AppSwitchBar', () => {
  beforeEach(() => {
    h.assign.mockReset();
    // jsdom's location.assign is non-functional — replace location wholesale.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: h.assign, hash: '' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  // apps/web's vitest setup does not auto-cleanup (globals: false).
  afterEach(() => cleanup());

  it('shows the current app, its siblings and the account tab', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my account/i })).toBeInTheDocument();
  });

  it('OMITTING an app hides its tab — this is decision 20s gate for sync/do', () => {
    // sit and study pass only each other until #304 is approved. If this stops
    // holding, sync/do becomes reachable from sit with no owner decision.
    renderBar();
    expect(screen.queryByRole('button', { name: /sync\/do/ })).toBeNull();
  });

  it('renders a do tab when — and only when — do is passed as a sibling', () => {
    renderBar({ siblings: SIBLINGS });
    expect(screen.getByRole('button', { name: /sync\/do/ })).toBeInTheDocument();
  });

  it('marks the current app as the active tab', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: /sync\/study/ })).not.toHaveAttribute('aria-current');
  });

  it('mints a code and navigates to the sibling with it in the URL FRAGMENT', async () => {
    const { mint } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(mint).toHaveBeenCalledTimes(1);
    // Fragment, never a query param: fragments never reach servers or logs.
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-study-app.web.app/handoff#code=code123&lang=en',
    );
  });

  it('url-encodes the code — handoff codes are not URL-safe by construction', async () => {
    renderBar({ mintHandoffCode: vi.fn().mockResolvedValue('abc+/=') });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-study-app.web.app/handoff#code=abc%2B%2F%3D&lang=en',
    );
  });

  it('carries the current language across the origin boundary', async () => {
    // i18n caches are per-origin localStorage, so without this the sibling
    // opens in whatever language it last saw rather than the current one.
    await i18n.changeLanguage('fr');
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-study-app.web.app/handoff#code=code123&lang=fr',
    );
  });

  it('is non-optimistic: nothing navigates until the mint resolves', async () => {
    let resolveMint!: (v: string) => void;
    renderBar({ mintHandoffCode: vi.fn(() => new Promise<string>((r) => (resolveMint = r))) });

    const tab = screen.getByRole('button', { name: /sync\/study/ });
    fireEvent.click(tab);

    await waitFor(() => expect(tab).toBeDisabled());
    expect(h.assign).not.toHaveBeenCalled();

    resolveMint('late');
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
  });

  it('disables EVERY tab while a switch is in flight, not just the one tapped', async () => {
    renderBar({
      siblings: SIBLINGS,
      mintHandoffCode: vi.fn(() => new Promise<string>(() => {})),
    });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /sync\/study/ })).toBeDisabled());
    // A second tap on a DIFFERENT app would mint a second code and race the
    // first navigation.
    expect(screen.getByRole('button', { name: /sync\/do/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /my account/i })).toBeDisabled();
  });

  it('surfaces a failure and re-enables, without navigating', async () => {
    renderBar({ mintHandoffCode: vi.fn().mockRejectedValue(new Error('boom')) });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not switch/i));
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeEnabled();
    expect(h.assign).not.toHaveBeenCalled();
  });

  // The bar is PERSISTENT -- it lives in the layout, outside <Outlet />, so it
  // never unmounts. The menu item it supersedes lived in a Dialog that
  // returned null when closed, which reset its error for free. Nothing does
  // that here, so the message's lifetime has to be managed explicitly.
  describe('the failure message belongs to one attempt, not to the session', () => {
    const failOnce = () =>
      renderBar({ mintHandoffCode: vi.fn().mockRejectedValue(new Error('boom')) });

    it('clears when the user navigates anywhere else in the app', async () => {
      const { navigateTo } = failOnce();
      fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

      // Without this the red line stays pinned to the bottom of EVERY screen
      // for the rest of the session.
      navigateTo('/family/appointments');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('clears when the user taps another tab instead of retrying', async () => {
      failOnce();
      fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /my account/i }));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('clears when the current-app tab is tapped, which navigates nowhere', async () => {
      // No prop overrides beyond the failing mint: every shipped shell
      // passes `home`, so this is the configuration a user actually meets.
      failOnce();
      fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

      // Tapping home while already home leaves pathname unchanged, so the
      // route-change reset above would not fire for this interaction.
      fireEvent.click(screen.getByRole('button', { name: /sync\/sit/ }));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('un-sticks a busy bar when the browser restores the page from bfcache', async () => {
    // Staying busy through the cross-origin navigation is correct, but the
    // back button can restore this page with that state intact. Every tab is
    // disabled while busy, so the bar would be permanently dead until reload.
    renderBar({ mintHandoffCode: vi.fn().mockResolvedValue('code123') });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /my account/i })).toBeDisabled();

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(screen.getByRole('button', { name: /my account/i })).toBeEnabled();
  });

  it('ignores a NON-restore pageshow — a first load must not cancel a live switch', async () => {
    renderBar({ mintHandoffCode: vi.fn(() => new Promise<string>(() => {})) });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /sync\/study/ })).toBeDisabled());

    // act() flushes the listener's state update; asserting straight after a
    // bare dispatch would pass even with the `persisted` guard deleted.
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    });
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeDisabled();
  });

  describe('height contract (#419) — jsdom applies no CSS, so the classes ARE the contract', () => {
    it('sizes the tab row with the shared token instead of letting content size it', () => {
      // h-app-switch-row reads --spacing-app-switch-row (base.css). With the
      // nav padding only the safe-area inset under it, the bar's total height
      // is exactly --spacing-app-switch-bar — the token every shell reserves
      // via pb-app-switch-bar. Replace this class with a content-sized row
      // and the bar's height stops being anything a shell can match.
      renderBar();
      const row = screen.getByRole('button', { name: /sync\/sit/ }).closest('ul')!;
      expect(row.className).toMatch(/(?<![\w-])h-app-switch-row(?![\w-])/);
    });

    it('pads the nav by the safe-area inset only — the row token covers the rest', () => {
      renderBar();
      const nav = screen.getByRole('navigation', { name: /switch app/i });
      expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');
      // The bar must not ALSO carry a fixed height: height = row + inset is
      // composed from the two pieces, not declared twice.
      expect(nav.className).not.toMatch(/(?<![\w-])h-app-switch-bar(?![\w-])/);
    });

    it('stretches every tab button to the row height — items-stretch only reaches the <li>', () => {
      // items-stretch (on the <ul>) stretches each <li> flex item to the row's
      // height, but a <button> is a plain in-flow child of its <li>, not a
      // flex item itself — stretch does not cascade into it. Without h-full
      // here the button stays content-sized (~58-61px) inside the taller
      // row, so justify-center centers within a box shorter than the row and
      // the bottom of the tab becomes dead, non-clickable space.
      renderBar();
      expect(screen.getByRole('button', { name: /sync\/sit/ }).className).toMatch(
        /(?<![\w-])h-full(?![\w-])/,
      );
      expect(screen.getByRole('button', { name: /my account/i }).className).toMatch(
        /(?<![\w-])h-full(?![\w-])/,
      );
    });

    it('the failure alert OVERLAYS above the bar instead of growing it', async () => {
      // In-flow, the alert made the bar ~24px taller than any shell's
      // reserved padding, covering content on every phone — the second half
      // of #419. absolute + bottom-full floats it over page content just
      // above the nav, so the bar's height stays the constant the token
      // promises; bg + border because it now sits over the page, not chrome.
      renderBar({ mintHandoffCode: vi.fn().mockRejectedValue(new Error('boom')) });
      fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

      const alert = await screen.findByRole('alert');
      expect(alert.className).toMatch(/(?<![\w-])absolute(?![\w-])/);
      expect(alert.className).toMatch(/(?<![\w-])bottom-full(?![\w-])/);
      expect(alert.className).toMatch(/(?<![\w-])bg-white(?![\w-])/);
    });
  });

  it('draws its focus ring INSIDE the tabs — they sit flush against the viewport edges', () => {
    // jsdom applies no CSS, so the class IS the contract here. The shared
    // WCAG 2.4.7 ring (base.css) offsets 2px outward plus a 2px white
    // backing; on a fixed bottom bar that ~4px falls outside the viewport and
    // is never painted for the bottom row and the end tabs.
    renderBar();
    const row = screen.getByRole('button', { name: /sync\/sit/ }).closest('ul')!;
    expect(row.className).toMatch(/\bfocus-ring-inset\b/);
  });

  it('navigates in-app for the account tab — no handoff, it is same-origin', () => {
    const { mint, onNavigateAccount } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: /my account/i }));

    expect(onNavigateAccount).toHaveBeenCalledWith('/family/account');
    expect(mint).not.toHaveBeenCalled();
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('omits the account tab entirely when there is nowhere for it to go', () => {
    // sync-do ships no account page (plan §18.3) — the shared hub owns
    // identity and do contributes only doer settings. Until #367 exists there
    // is no route to point at, and a tab leading nowhere is worse than none.
    render(
      <I18nextProvider i18n={i18n}>
        <AppSwitchBar
          current="do"
          siblings={SIBLINGS}
          mintHandoffCode={vi.fn()}
          pathname="/doer"
          home={{ href: '/doer', onNavigate: vi.fn() }}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole('button', { name: /my account/i })).toBeNull();
    expect(screen.getByRole('button', { name: /sync\/do/ })).toBeInTheDocument();
  });

  it('the current app tab is inert when no home target is given', () => {
    // A legitimate state, but one no shell ships -- all six pass `home`.
    renderBar({ home: undefined });
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeDisabled();
  });

  it('navigates home when the current app tab is tapped', () => {
    const { onNavigateHome } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: /sync\/sit/ }));

    expect(onNavigateHome).toHaveBeenCalledWith('/family');
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('uses bar-weight marks, never the 256px originals', () => {
    // The bar renders every app's mark on every screen and is phone-only;
    // reaching for a full-size mark costs ~100 KB per app (#364).
    renderBar({ siblings: SIBLINGS });
    const marks = screen.getAllByRole('presentation', { hidden: true });
    // Assert the query found something BEFORE looping: an empty result would
    // make every assertion below vacuous and the test green for free.
    expect(marks).toHaveLength(3);
    for (const img of marks) {
      expect(img.getAttribute('src') ?? '').toMatch(/-48\./);
      expect(img.getAttribute('srcset') ?? '').toMatch(/-96\./);
    }
  });
});
