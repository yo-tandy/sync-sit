import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within, cleanup, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/AppBar', () => ({ AppBar: () => <div data-testid="appbar" /> }));
vi.mock('@/components/ui/FamilyAppBar', () => ({ FamilyAppBar: () => <div data-testid="appbar" /> }));

import { renderWithProviders } from '@/__tests__/test-utils';
import { TutorLayout } from '../TutorLayout';
import { FamilyLayout } from '../FamilyLayout';

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
 * study is the app whose two shells pass DIFFERENT account paths, so both are
 * exercised: a typo'd tutor path would otherwise ship silently.
 */
describe('the app-switch bar is mounted in study’s shells (#365)', () => {
  afterEach(cleanup);

  const shellPins = (homeText: string) => {
    const bar = screen.getByRole('navigation', { name: /switch app/i });
    shellReservesBarHeight(bar);
    // aria-current proves the host passed THIS path: the bar derives the
    // active tab from the route it is given.
    expect(within(bar).getByRole('button', { name: /my account/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    currentAppTabNavigatesHome(bar, /sync\/study/, homeText);
  };

  it('TutorLayout renders the bar, with the TUTOR account path', () => {
    renderWithProviders(
      <Routes>
        <Route element={<TutorLayout />}>
          <Route path="/tutor/account" element={<div>tutor account</div>} />
          <Route path="/tutor" element={<div>tutor home</div>} />
        </Route>
      </Routes>,
      '/tutor/account',
    );
    shellPins('tutor home');
  });

  it('FamilyLayout renders the bar, with the FAMILY account path', () => {
    renderWithProviders(
      <Routes>
        <Route element={<FamilyLayout />}>
          <Route path="/family/account" element={<div>family account</div>} />
          <Route path="/family" element={<div>family home</div>} />
        </Route>
      </Routes>,
      '/family/account',
    );
    shellPins('family home');
  });
});
