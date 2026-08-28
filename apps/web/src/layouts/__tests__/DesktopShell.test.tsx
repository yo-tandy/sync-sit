import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/AppBar', () => ({ AppBar: () => <div data-testid="appbar" /> }));

import { FamilyLayout } from '../FamilyLayout';
import { BabysitterLayout } from '../BabysitterLayout';

function renderLayout(layout: React.ReactElement, pageText: string) {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={layout}>
          <Route index element={<div>{pageText}</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function shellPin(pageText: string) {
  // The routed page must sit inside the PageContainer cap (issue #119) —
  // jsdom applies no CSS, so the classes are the responsive contract.
  const container = screen.getByText(pageText).parentElement!;
  expect(container.className).toMatch(/\bmx-auto\b/);
  expect(container.className).toMatch(/\bmax-w-2xl\b/);
  expect(container.className).toContain('has-[[data-page-width=wide]]:max-w-5xl');
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
});
