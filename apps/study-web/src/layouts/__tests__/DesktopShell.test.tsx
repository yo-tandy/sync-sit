import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';

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
