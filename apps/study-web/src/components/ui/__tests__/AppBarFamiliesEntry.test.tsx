import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    firebaseUser: { uid: 't1' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { renderWithProviders } from '@/__tests__/test-utils';
import { AppBar } from '../AppBar';
import { router } from '@/router';

/**
 * Entry-point pins for the tutor "My families" surface (issue #172): the tutor
 * menu exposes a "My Families" item routed to /tutor/families, mirroring
 * sync-sit's babysitter AppBar entry (menu.myFamilies → /babysitter/families),
 * and the route exists inside the tutor layout block.
 */
describe('tutor "My families" entry points', () => {
  it('shows the families entry in the tutor menu, linking to /tutor/families', () => {
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const link = screen.getByRole('link', { name: /my families/i });
    expect(link).toHaveAttribute('href', '/tutor/families');
  });

  it('registers the /tutor/families route', () => {
    const paths: string[] = [];
    type RouteNode = { path?: string; children?: RouteNode[] };
    const walk = (routes: RouteNode[]) =>
      routes.forEach((r) => {
        if (r.path) paths.push(r.path);
        if (r.children) walk(r.children);
      });
    walk(router.routes as RouteNode[]);
    expect(paths).toContain('/tutor/families');
  });
});
