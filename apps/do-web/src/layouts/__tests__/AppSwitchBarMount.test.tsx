import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
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
describe('the app-switch bar is mounted in do-web’s shells (#365)', () => {
  afterEach(cleanup);

  const renderShell = (layout: React.ReactElement, path: string, text: string) =>
    renderWithProviders(
      <Routes>
        <Route element={layout}>
          <Route path={path} element={<div>{text}</div>} />
        </Route>
      </Routes>,
      path,
    );

  it('DoerLayout renders the bar', async () => {
    renderShell(<DoerLayout />, '/doer', 'doer page');
    expect(await screen.findByRole('navigation', { name: /switch app/i })).toBeInTheDocument();
  });

  it('FamilyLayout renders the bar', async () => {
    renderShell(<FamilyLayout />, '/family', 'family page');
    expect(await screen.findByRole('navigation', { name: /switch app/i })).toBeInTheDocument();
  });

  it('neither bar offers an account tab — do ships no account page (§18.3)', async () => {
    renderShell(<DoerLayout />, '/doer', 'doer page');
    await screen.findByRole('navigation', { name: /switch app/i });
    expect(screen.queryByRole('button', { name: /my account/i })).toBeNull();
  });
});
