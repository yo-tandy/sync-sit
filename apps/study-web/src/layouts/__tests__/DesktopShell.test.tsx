import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within, cleanup } from '@testing-library/react';
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
 * "Shipped in all six shells" (#365) is a claim about the LAYOUTS, and until
 * this block existed deleting <AppSwitchBarHost /> from either shell left the
 * whole suite green — every other bar test renders a host in isolation.
 *
 * study is the app whose two shells pass DIFFERENT account paths, so both are
 * exercised: a typo'd tutor path would otherwise ship silently.
 */
describe('the app-switch bar is mounted in study’s shells (#365)', () => {
  afterEach(cleanup);

  const accountTabIsCurrent = () => {
    const bar = screen.getByRole('navigation', { name: /switch app/i });
    // aria-current proves the host passed THIS path: the bar derives the
    // active tab from the route it is given.
    expect(within(bar).getByRole('button', { name: /my account/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  };

  it('TutorLayout renders the bar, with the TUTOR account path', () => {
    renderWithProviders(
      <Routes>
        <Route element={<TutorLayout />}>
          <Route path="/tutor/account" element={<div>tutor account</div>} />
        </Route>
      </Routes>,
      '/tutor/account',
    );
    accountTabIsCurrent();
  });

  it('FamilyLayout renders the bar, with the FAMILY account path', () => {
    renderWithProviders(
      <Routes>
        <Route element={<FamilyLayout />}>
          <Route path="/family/account" element={<div>family account</div>} />
        </Route>
      </Routes>,
      '/family/account',
    );
    accountTabIsCurrent();
  });
});
