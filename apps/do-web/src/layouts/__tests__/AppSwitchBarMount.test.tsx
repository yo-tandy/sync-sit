import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, within, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router';

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/DoerAppBar', () => ({ DoerAppBar: () => <div data-testid="appbar" /> }));
vi.mock('@/components/ui/FamilyAppBar', () => ({
  FamilyAppBar: () => <div data-testid="appbar" />,
}));
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));

import { renderWithProviders } from '@/__tests__/test-utils';
import { DoerLayout } from '../DoerLayout';
import { FamilyLayout } from '../FamilyLayout';

/**
 * "Shipped in all six shells" (#365) is a claim about the LAYOUTS, and until
 * this file existed deleting <AppSwitchBarHost /> from either do-web shell
 * left the whole suite green — the host test renders it in isolation.
 *
 * do-web's bar carries NO account tab (plan §18.3: do ships no account page;
 * the shared hub owns identity, #367), so the mount assertion is the nav
 * landmark itself rather than an account path.
 */

/**
 * The fixed bar and each shell's bottom padding are a MATCHED PAIR, and only
 * one half was pinned. Delete `pb-16` and every page still renders, every
 * mount test stays green, and the last row of each scrolled page sits under
 * the bar on a phone — the same "invisible by construction" shape the mount
 * assertions exist for. `md:pb-0` matters as much: the padding has to lift at
 * exactly the breakpoint the bar disappears at (PR #385 round 4).
 */
function shellReservesBarHeight(bar: HTMLElement) {
  const shellRoot = bar.parentElement!;
  expect(shellRoot.className).toMatch(/\bpb-16\b/);
  expect(shellRoot.className).toMatch(/\bmd:pb-0\b/);
}

/**
 * The current-app tab is `disabled` unless the shell supplies `home`, and for
 * a while no shell did — the component honoured the prop, its own tests passed
 * it, and every shipped bar had a permanently dead tab (PR #385 round 4). It
 * matters twice over here: with no account tab (§3), this is do's ONLY in-app
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

  it('neither bar offers an account tab — do ships no account page (§3)', async () => {
    renderShell(<DoerLayout />, '/doer', '/doer/board');
    await screen.findByRole('navigation', { name: /switch app/i });
    expect(screen.queryByRole('button', { name: /my account/i })).toBeNull();
  });
});
