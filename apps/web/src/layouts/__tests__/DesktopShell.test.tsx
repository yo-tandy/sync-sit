import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/AppBar', () => ({ AppBar: () => <div data-testid="appbar" /> }));

import i18n from '@/i18n';
import { FamilyLayout } from '../FamilyLayout';
import { BabysitterLayout } from '../BabysitterLayout';
import { AdminLayout } from '../AdminLayout';

function renderLayout(layout: React.ReactElement, pageText: string) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Routes>
          <Route element={layout}>
            <Route index element={<div>{pageText}</div>} />
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
