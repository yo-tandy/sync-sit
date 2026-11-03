import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';

vi.mock('@/config/firebase', () => ({ functions: {} }));
// Pending forever unless a test resolves it -- the default every other pin
// in this file relies on (no handoff ever completes by accident).
const h = vi.hoisted(() => ({ mint: vi.fn(() => new Promise(() => {})) }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => h.mint(),
}));

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/AppBar', () => ({ AppBar: () => <div data-testid="appbar" /> }));
vi.mock('@/components/ui/FamilyAppBar', () => ({ FamilyAppBar: () => <div data-testid="appbar" /> }));

import { renderWithProviders } from '@/__tests__/test-utils';
import { TutorLayout } from '../TutorLayout';
import { FamilyLayout } from '../FamilyLayout';
import { SIT_APP_URL } from '@/utils/appSwitch';

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

function shellPin(pageText: string) {
  // The routed page must sit inside the PageContainer cap (issue #119) —
  // jsdom applies no CSS, so the classes are the responsive contract.
  const container = screen.getByText(pageText).parentElement!;
  expect(container.className).toMatch(/\bmx-auto\b/);
  expect(container.className).toMatch(/\bmax-w-2xl\b/);
  expect(container.className).toContain('has-[>[data-page-width=wide]]:max-w-5xl');
}

describe('study portal shells cap routed content (issue #119)', () => {
  it('TutorLayout wraps its Outlet in the PageContainer', () => {
    renderWithProviders(
      <Routes>
        <Route element={<TutorLayout />}>
          <Route index element={<div>tutor page</div>} />
        </Route>
      </Routes>,
    );
    shellPin('tutor page');
  });

  it('FamilyLayout wraps its Outlet in the PageContainer', () => {
    renderWithProviders(
      <Routes>
        <Route element={<FamilyLayout />}>
          <Route index element={<div>family page</div>} />
        </Route>
      </Routes>,
    );
    shellPin('family page');
  });
});

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
 * value the bar itself is sized by — appSwitchBarHeight.test.ts (this app's
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
 * it, and every shipped bar had a permanently dead tab (PR #385 round 4).
 *
 * This FOLLOWS the navigation rather than asserting the tab is enabled.
 * Enabled is not enough: the host builds `home={{ href: homeHref, ... }}`
 * unconditionally, so a shell that stops passing `homeHref` still yields a
 * truthy `home` and an enabled, useless tab. Landing on the home route is the
 * only assertion that fails when the shell drops the prop — verified, because
 * the enabled-only version of this pin did NOT go red under that mutation.
 */
function currentAppTabNavigatesHome(bar: HTMLElement, app: RegExp, homeText: string) {
  fireEvent.click(within(bar).getByRole('button', { name: app }));
  expect(screen.getByText(homeText)).toBeInTheDocument();
}

/**
 * "Shipped in all six shells" (#365) is a claim about the LAYOUTS, and until
 * this block existed deleting <AppSwitchBarHost /> from either shell left the
 * whole suite green — every other bar test renders a host in isolation.
 *
 * Both shells are exercised, and both must send "My account" to the ONE hub
 * on sync-sit -- they used to pass two different study profile paths.
 */
describe('the app-switch bar is mounted in study’s shells (#365)', () => {
  afterEach(cleanup);

  const shellPins = async (homeText: string) => {
    const bar = screen.getByRole('navigation', { name: /switch app/i });
    shellReservesBarHeight(bar);
    // Rendered ON the study profile page: a host still pointing the account
    // tab there would mark it aria-current.
    expect(within(bar).getByRole('button', { name: /my account/i })).not.toHaveAttribute(
      'aria-current',
    );
    currentAppTabNavigatesHome(bar, /sync\/study/, homeText);
    // Last: a completed handoff leaves the bar busy (the page is leaving).
    await accountTabHandsOffToHub(bar);
  };

  it('TutorLayout renders the bar, and its account tab hands off to the sit hub', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<TutorLayout />}>
          <Route path="/tutor/account" element={<div>tutor account</div>} />
          <Route path="/tutor" element={<div>tutor home</div>} />
        </Route>
      </Routes>,
      '/tutor/account',
    );
    await shellPins('tutor home');
  });

  it('FamilyLayout renders the bar, and its account tab hands off to the sit hub', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<FamilyLayout />}>
          <Route path="/family/account" element={<div>family account</div>} />
          <Route path="/family" element={<div>family home</div>} />
        </Route>
      </Routes>,
      '/family/account',
    );
    await shellPins('family home');
  });
});
