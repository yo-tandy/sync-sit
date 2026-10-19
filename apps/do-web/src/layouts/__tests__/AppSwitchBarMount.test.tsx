import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/DoerAppBar', () => ({ DoerAppBar: () => <div data-testid="appbar" /> }));
vi.mock('@/components/ui/FamilyAppBar', () => ({
  FamilyAppBar: () => <div data-testid="appbar" />,
}));
vi.mock('@/config/firebase', () => ({ functions: {} }));
// Pending forever unless a test resolves it -- no handoff completes by accident.
const h = vi.hoisted(() => ({ mint: vi.fn(() => new Promise(() => {})) }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => h.mint(),
}));

import { renderWithProviders } from '@/__tests__/test-utils';
import { DoerLayout } from '../DoerLayout';
import { FamilyLayout } from '../FamilyLayout';
import { SIT_APP_URL } from '@/utils/appSwitch';

/**
 * "Shipped in all six shells" (#365) is a claim about the LAYOUTS, and until
 * this file existed deleting <AppSwitchBarHost /> from either do-web shell
 * left the whole suite green — the host test renders it in isolation.
 *
 * do ships no account page (plan §18.3), so its account tab hands off to the
 * suite's one hub on sync-sit; the mount assertion is the nav landmark.
 */

/**
 * The suite has ONE account hub, on sync-sit. A shell's account tab must
 * HAND OFF there (`next=/account`), never route to this app's own profile
 * page -- the inconsistency this pin exists for: sit's tab opened the hub
 * while study's opened `/tutor/account` or `/family/account`.
 */
async function accountTabHandsOffToHub(bar: HTMLElement) {
  const assign = vi.fn();
  const original = window.location;
  Object.defineProperty(window, 'location', {
    value: { ...original, assign, hash: '' },
    writable: true,
    configurable: true,
  });
  try {
    h.mint.mockResolvedValueOnce({ data: { code: 'c1' } });
    const tab = within(bar).getByRole('button', { name: /my account/i });
    // Never the active tab: the hub is never on screen in this app.
    expect(tab).not.toHaveAttribute('aria-current');
    fireEvent.click(tab);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0][0]).toBe(
      `${SIT_APP_URL}/handoff#code=c1&lang=en&next=%2Faccount`,
    );
  } finally {
    Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
  }
}


/**
 * The fixed bar and each shell's bottom padding are a MATCHED PAIR, and only
 * one half was pinned. Delete the reservation and every page still renders,
 * every mount test stays green, and the last row of each scrolled page sits
 * under the bar on a phone — the same "invisible by construction" shape the
 * mount assertions exist for. `md:pb-0` matters as much: the padding has to
 * lift at exactly the breakpoint the bar disappears at (PR #385 round 4).
 *
 * The reservation is the shared TOKEN, not a number (#419): `pb-16` was a
 * fixed 64px against a bar whose height grows with the safe-area inset, so a
 * home-indicator phone hid the bottom ~30px of every scrolled page.
 * `pb-app-switch-bar` reads `--spacing-app-switch-bar` (base.css), the same
 * value the bar itself is sized by — appSwitchBarHeight.test.ts (study-web's
 * shared-ui suite) pins the token side of that coupling.
 */
function shellReservesBarHeight(bar: HTMLElement) {
  const shellRoot = bar.parentElement!;
  expect(shellRoot.className).toMatch(/(?<![\w-])pb-app-switch-bar(?![\w-])/);
  expect(shellRoot.className).toMatch(/\bmd:pb-0\b/);
}

/**
 * The current-app tab is `disabled` unless the shell supplies `home`, and for
 * a while no shell did — the component honoured the prop, its own tests passed
 * it, and every shipped bar had a permanently dead tab (PR #385 round 4). It
 * matters twice over here: every other tab leaves the origin, so this is do's ONLY in-app
 * control on the bar, and the only thing that clears a failed-switch message
 * without a route change or a retry.
 *
 * This FOLLOWS the navigation rather than asserting the tab is enabled.
 * Enabled is not enough: the host builds `home={{ href: homeHref, ... }}`
 * unconditionally, so a shell that stops passing `homeHref` still yields a
 * truthy `home` and an enabled, useless tab. Landing on the home route is the
 * only assertion that fails when the shell drops the prop — verified, because
 * the enabled-only version of this pin did NOT go red under that mutation.
 * Rendering must therefore START somewhere other than home, or the home text
 * is already on screen and the assertion proves nothing.
 */
function currentAppTabNavigatesHome(bar: HTMLElement, homeText: string) {
  fireEvent.click(within(bar).getByRole('button', { name: /sync\/do/ }));
  expect(screen.getByText(homeText)).toBeInTheDocument();
}

describe('the app-switch bar is mounted in do-web’s shells (#365)', () => {
  afterEach(cleanup);

  /** Starts on a SUB-route so navigating home is observable. */
  const renderShell = (layout: React.ReactElement, home: string, sub: string) =>
    renderWithProviders(
      <Routes>
        <Route element={layout}>
          <Route path={sub} element={<div>sub page</div>} />
          <Route path={home} element={<div>{home} home</div>} />
        </Route>
      </Routes>,
      sub,
    );

  it('DoerLayout renders the bar, reserves its height, and its tab goes home', async () => {
    renderShell(<DoerLayout />, '/doer', '/doer/board');
    const bar = await screen.findByRole('navigation', { name: /switch app/i });
    shellReservesBarHeight(bar);
    currentAppTabNavigatesHome(bar, '/doer home');
  });

  it('FamilyLayout renders the bar, reserves its height, and its tab goes home', async () => {
    renderShell(<FamilyLayout />, '/family', '/family/tasks');
    const bar = await screen.findByRole('navigation', { name: /switch app/i });
    shellReservesBarHeight(bar);
    currentAppTabNavigatesHome(bar, '/family home');
  });

  it('DoerLayout\'s account tab hands off to the one hub on sync-sit', async () => {
    renderShell(<DoerLayout />, '/doer', '/doer/board');
    const bar = await screen.findByRole('navigation', { name: /switch app/i });
    await accountTabHandsOffToHub(bar);
  });

  it('FamilyLayout\'s account tab hands off to the one hub on sync-sit', async () => {
    renderShell(<FamilyLayout />, '/family', '/family/tasks');
    const bar = await screen.findByRole('navigation', { name: /switch app/i });
    await accountTabHandsOffToHub(bar);
  });
});
