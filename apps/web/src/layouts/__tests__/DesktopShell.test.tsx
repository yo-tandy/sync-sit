import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/AppBar', () => ({ AppBar: () => <div data-testid="appbar" /> }));
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
// AccountLayout only: the real store subscribes to Firebase at import, and
// the hub reads just userDoc from it. null = a member with no sit role, so
// the layout's homeHref falls back to '/'.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel: (s: { userDoc: null }) => unknown) => sel({ userDoc: null }),
}));
vi.mock('@/components/ui/AppSwitchMenuItem', () => ({
  AppSwitchMenuItem: () => <div data-testid="switch-menu-item" />,
}));

import i18n from '@/i18n';
import { FamilyLayout } from '../FamilyLayout';
import { BabysitterLayout } from '../BabysitterLayout';
import { AdminLayout } from '../AdminLayout';
import { AccountLayout } from '../AccountLayout';

function renderLayout(
  layout: React.ReactElement,
  pageText: string,
  path?: string,
  /** Extra routes under the same layout, so in-app navigation can be followed. */
  also: ReadonlyArray<{ path: string; text: string }> = [],
) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path ?? '/']}>
        <Routes>
          <Route element={layout}>
            <Route path={path ?? '/'} element={<div>{pageText}</div>} />
            {also.map((r) => (
              <Route key={r.path} path={r.path} element={<div>{r.text}</div>} />
            ))}
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function shellPin(pageText: string) {
  // The routed page must sit inside the PageContainer cap (issue #119) —
  // jsdom applies no CSS, so the classes are the responsive contract.
  const container = screen.getByText(pageText).parentElement!;
  expect(container.className).toMatch(/\bmx-auto\b/);
  expect(container.className).toMatch(/\bmax-w-2xl\b/);
  expect(container.className).toContain('has-[>[data-page-width=wide]]:max-w-5xl');
}

describe('sit portal shells cap routed content (issue #119)', () => {
  afterEach(cleanup);

  it('FamilyLayout wraps its Outlet in the PageContainer', () => {
    renderLayout(<FamilyLayout />, 'family page');
    shellPin('family page');
  });

  it('BabysitterLayout wraps its Outlet in the PageContainer', () => {
    renderLayout(<BabysitterLayout />, 'babysitter page');
    shellPin('babysitter page');
  });

  it('AdminLayout wraps its Outlet in the PageContainer inside the sidebar flex row', () => {
    renderLayout(<AdminLayout />, 'admin page');
    shellPin('admin page');
    // min-w-0 flex-1 lets DataTables shrink inside the flex row instead of
    // forcing horizontal page scroll.
    const flexChild = screen.getByText('admin page').parentElement!.parentElement!;
    expect(flexChild.className).toMatch(/\bmin-w-0\b/);
    expect(flexChild.className).toMatch(/\bflex-1\b/);
  });

  it('AdminLayout renders the grouped desktop sidebar with every admin destination', () => {
    renderLayout(<AdminLayout />, 'admin page');
    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:block\b/);
    // The #140 dashboard grouping, mirrored: People / Trust & safety / Operations.
    for (const section of ['People', 'Trust & safety', 'Operations']) {
      expect(within(nav).getByRole('heading', { name: section })).toBeInTheDocument();
    }
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/admin',
      '/admin/users',
      '/admin/families',
      '/admin/verifications',
      '/admin/enrollment-access',
      '/admin/governance',
      '/admin/appointments',
      // sync-do §9.4 — admin tooling. This exact-list assertion is also the
      // decision-20 guard on the sit sidebar: a sync-do destination outside
      // the admin tree would have to be added here to pass.
      '/admin/do-tasks',
      '/admin/holidays',
      '/admin/configuration',
      '/admin/audit-log',
      '/admin/gdpr-export',
    ]);
  });
});

/**
 * "Shipped in all six shells" (#365) is a claim about the LAYOUTS, and until
 * this block existed deleting <AppSwitchBarHost /> from either shell left the
 * whole suite green — every other bar test renders a host in isolation.
 *
 * The admin case is the load-bearing one: AdminLayout deliberately has NO
 * bar, which is exactly why AppBar keeps the burger switch row for admins at
 * every width.
 */
const SWITCH_BAR = { name: /switch app/i } as const;

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

describe('the app-switch bar is mounted in sit’s shells (#365)', () => {
  afterEach(cleanup);

  it('FamilyLayout renders the bar, pointing at the SHARED account hub', () => {
    // '/account', not '/family/account' (#367): the hub is one page for every
    // portal, which is the point of it. The pin still proves the host passed
    // a real path -- the bar derives the active tab from the route it is
    // given -- it just pins the collapsed path now rather than the portal one.
    renderLayout(<FamilyLayout />, 'family page', '/account', [
      { path: '/family', text: 'parent home' },
    ]);
    const bar = screen.getByRole('navigation', SWITCH_BAR);
    shellReservesBarHeight(bar);
    expect(within(bar).getByRole('button', { name: /my account/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    currentAppTabNavigatesHome(bar, /sync\/sit/, 'parent home');
  });

  it('BabysitterLayout renders the bar, pointing at the SAME shared hub', () => {
    // The babysitter's account USED to live at a different path than the
    // parent's, and this pin existed because a typo between them would ship
    // silently. #367 removes the divergence at the source: both portals now
    // send the account tab to the one hub, so the pin's job flips from
    // "these two differ correctly" to "these two no longer differ at all".
    renderLayout(<BabysitterLayout />, 'babysitter page', '/account', [
      { path: '/babysitter', text: 'babysitter home' },
    ]);
    const bar = screen.getByRole('navigation', SWITCH_BAR);
    shellReservesBarHeight(bar);
    expect(within(bar).getByRole('button', { name: /my account/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    currentAppTabNavigatesHome(bar, /sync\/sit/, 'babysitter home');
  });

  it('AdminLayout renders NO bar — which is why the burger keeps admin’s switch row', () => {
    renderLayout(<AdminLayout />, 'admin page');
    expect(screen.queryByRole('navigation', SWITCH_BAR)).toBeNull();
  });

  it('AccountLayout — the SEVENTH mounting shell — reserves the token height too (#419)', () => {
    // The account hub was missing from #419's own list of six, but it mounts
    // the same fixed bar over the same scrolled content ("the bottom bar is
    // how you leave", its docblock says) — the shell with NO bar is
    // AdminLayout, above. Element-level pin, because the file-level coupling
    // test (study-web's appSwitchBarHeight.test.ts) cannot see that the
    // padding sits on the div that actually wraps the page.
    renderLayout(<AccountLayout />, 'account hub', '/account', [
      { path: '/', text: 'roleless home' },
    ]);
    // TWO landmarks share the switch label here: the md+ header exit row
    // (#416) and the phone bar. The bar is the `fixed` one, and only ITS
    // parent is the shell div that must reserve the height.
    const bar = screen
      .getAllByRole('navigation', SWITCH_BAR)
      .find((n) => /\bfixed\b/.test(n.className));
    expect(bar).toBeTruthy();
    shellReservesBarHeight(bar!);
    // userDoc is null under this file's store mock, so homeHref falls back
    // to '/' — and #385's rule that the current-app tab actually navigates
    // must hold for the hub as well.
    currentAppTabNavigatesHome(bar!, /sync\/sit/, 'roleless home');
  });
});
