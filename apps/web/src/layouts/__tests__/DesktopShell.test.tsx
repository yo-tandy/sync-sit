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
    // The desktop header (below) no longer carries its own `<nav>` landmark
    // sharing this label (#445 review) -- it did before, when it was a
    // second, separate exit row from the one this test pins. The ONE
    // remaining landmark with this label is the real phone bar, and it is
    // the `fixed` one; only ITS parent is the shell div that must reserve
    // the height.
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

/**
 * The hub's ONE header (#445 review). It used to be TWO: `AccountHome`
 * (shared-ui) rendered its own always-visible sticky "Sync/Account" banner,
 * while this layout separately rendered a `hidden md:block` exit row (Home
 * link + app-switch menu) -- both full-bleed, both `z-40`, so at `md+` one
 * painted over the other. There is exactly one header now, owned here, at
 * every breakpoint.
 */
describe('AccountLayout renders the hub’s ONE header, every breakpoint (#445 review)', () => {
  afterEach(cleanup);

  it('titles the header "Sync/Account" regardless of viewport (jsdom has no breakpoints — this proves it is not hidden)', () => {
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    expect(header).toBeInTheDocument();
    // Not inside a `hidden` wrapper -- unlike the old md-only exit row.
    expect(header.className).not.toMatch(/\bhidden\b/);
  });

  it('is sticky, not fixed -- this layout already sits outside PageContainer, so sticky is full-bleed here', () => {
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    expect(header.className).toMatch(/\bsticky\b/);
    expect(header.className).not.toMatch(/\bfixed\b/);
    expect(header.className).toMatch(/\btop-0\b/);
  });

  it('is neutral -- bg-ground-admin, never a brand colour', () => {
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    expect(header.className).toMatch(/\bbg-ground-admin\b/);
    expect(header.className).not.toMatch(/bg-brand/);
  });

  it('keeps the Home-link and app-switch-menu slots, now hidden md:flex EACH instead of the whole header being md:block', () => {
    // userDoc is mocked null for this whole file, so the Home link itself
    // does not render here (no sit role -> no portalHref) -- that slot's
    // OWN visibility class is still assertable regardless of its contents.
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    const slots = header.querySelectorAll(':scope > nav');
    expect(slots).toHaveLength(2);
    for (const slot of Array.from(slots)) {
      expect(slot.className).toMatch(/\bhidden\b/);
      expect(slot.className).toMatch(/\bmd:flex\b/);
    }
    // The second slot holds the (mocked) app-switch menu item, which always
    // renders regardless of role.
    expect(within(header).getByTestId('switch-menu-item')).toBeInTheDocument();
  });

  it('flanks the title with equal flex-1/basis-0 slots, not a fixed width -- a fixed w-24 clipped "Open sync-study" onto three wrapped lines (screenshot review of #484)', () => {
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    const slots = header.querySelectorAll(':scope > nav');
    expect(slots).toHaveLength(2);
    for (const slot of Array.from(slots)) {
      expect(slot.className).toMatch(/\bflex-1\b/);
      expect(slot.className).toMatch(/\bbasis-0\b/);
      expect(slot.className).not.toMatch(/\bw-24\b/);
    }
    // The title itself must NOT grow -- it has to stay sized to its own
    // content so the two equal flex-1 slots do the centring.
    const title = screen.getByText('Sync/Account');
    expect(title.className).toMatch(/\bshrink-0\b/);
  });

  it('centres the title even below md, where both flanks are display:none and it is the only flex child (regression on a1e5f12)', () => {
    // jsdom applies no layout, so this pins the CLASS that produces centring
    // at that breakpoint rather than a measured position. At md+ the two
    // equal flex-1 flanks already consume all the leftover space, making
    // justify-center inert there -- it is what centres the lone title once
    // both flanks vanish below md.
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    expect(header.className).toMatch(/\bjustify-center\b/);
  });

  it('restores the desktop exits as real <nav> landmarks with DISTINCT names -- "Home" for the home link, the switch label only on the switcher', () => {
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    // Exactly one landmark per name inside the header: two simultaneously
    // visible navs sharing "Switch app" would be indistinguishable to a
    // screen-reader user navigating by landmark (review on #484).
    const switcher = within(header).getAllByRole('navigation', SWITCH_BAR);
    expect(switcher).toHaveLength(1);
    expect(within(switcher[0]).getByTestId('switch-menu-item')).toBeInTheDocument();
    const home = within(header).getAllByRole('navigation', { name: /^home$/i });
    expect(home).toHaveLength(1);
    expect(within(home[0]).queryByTestId('switch-menu-item')).toBeNull();
  });

  it('never wraps the app-switch slot’s content -- whitespace-nowrap on the wrapper, not inside AppSwitchMenuItem itself', () => {
    // On the wrapper, not the (mocked-here) component: `white-space`
    // inherits down to the real label without needing AppSwitchMenuItem's
    // own markup to change, which would also affect its OTHER home --
    // AppBar's full-width burger menu, where wrapping was never a problem.
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    const menuSlot = within(header).getByTestId('switch-menu-item').parentElement!;
    expect(menuSlot.className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('has no back button and no bell -- title and (at md+) the exit controls only', () => {
    renderLayout(<AccountLayout />, 'account hub');
    const header = screen.getByText('Sync/Account').closest('header')!;
    expect(within(header).queryByRole('button', { name: /back|retour/i })).toBeNull();
    expect(within(header).queryAllByRole('img')).toHaveLength(0);
  });
});
