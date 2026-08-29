import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
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

import i18n from '@/i18n';
import { FamilyLayout } from '../FamilyLayout';
import { BabysitterLayout } from '../BabysitterLayout';
import { AdminLayout } from '../AdminLayout';

function renderLayout(layout: React.ReactElement, pageText: string, path?: string) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path ?? '/']}>
        <Routes>
          <Route element={layout}>
            <Route path={path ?? '/'} element={<div>{pageText}</div>} />
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

describe('the app-switch bar is mounted in sit’s shells (#365)', () => {
  afterEach(cleanup);

  it('FamilyLayout renders the bar, with the parent account path', () => {
    renderLayout(<FamilyLayout />, 'family page', '/family/account');
    const bar = screen.getByRole('navigation', SWITCH_BAR);
    // aria-current proves the host passed '/family/account', not some other
    // path: the bar derives the active tab from the route it is given.
    expect(within(bar).getByRole('button', { name: /my account/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('BabysitterLayout renders the bar, with the BABYSITTER account path', () => {
    // The student's account lives at a different path than the parent's; a
    // typo here would ship silently.
    renderLayout(<BabysitterLayout />, 'babysitter page', '/babysitter/account');
    const bar = screen.getByRole('navigation', SWITCH_BAR);
    expect(within(bar).getByRole('button', { name: /my account/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('AdminLayout renders NO bar — which is why the burger keeps admin’s switch row', () => {
    renderLayout(<AdminLayout />, 'admin page');
    expect(screen.queryByRole('navigation', SWITCH_BAR)).toBeNull();
  });
});
