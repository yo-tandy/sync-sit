import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (_q: unknown, next: (snap: { docs: { id: string; data: () => Row }[] }) => void) => {
    next({ docs: h.rows.map((r, i) => ({ id: String(i), data: () => r })) });
    return () => {};
  },
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
import { FamilyAppBar } from '../FamilyAppBar';

const tabsNav = () => screen.getByRole('navigation', { name: /primary navigation/i });

/**
 * Issue #119 (UX F5): the burger's primary destinations render a second time
 * as a persistent md+ tab row — same link list, two renderings. These pins
 * hold the tab row to the full burger list per portal (no curation drift) and
 * keep the endorsement badge signal present in both renderings.
 */
describe('study desktop nav tabs', () => {
  it('tutor AppBar promotes every primary burger destination to the md+ tabs', () => {
    h.rows = [];
    renderWithProviders(<AppBar />);
    const nav = tabsNav();
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/tutor/requests',
      '/tutor/families',
      '/tutor/sessions',
      '/tutor/endorsements',
      '/tutor/account',
      '/tutor/subjects',
      '/tutor/schedule',
    ]);
  });

  it('tutor tabs carry the pending-endorsement badge (issue #196 signal, tab rendering)', () => {
    h.rows = [
      { tutorUserId: 't1', status: 'private' },
      { tutorUserId: 't1', status: 'private' },
      { tutorUserId: 't1', status: 'approved' },
    ];
    renderWithProviders(<AppBar />);
    const endorsements = within(tabsNav()).getByRole('link', { name: /endorsements/i });
    expect(within(endorsements).getByText('2').className).toMatch(/bg-amber-100/);
  });

  it('family FamilyAppBar promotes every primary burger destination to the md+ tabs', () => {
    h.rows = []; // FamilyAppBar has no subscription today; keep the case order-independent anyway.
    renderWithProviders(<FamilyAppBar />);
    const hrefs = within(tabsNav())
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/family/sessions',
      '/family/requests',
      '/family/endorsements',
      '/family/governance',
      '/family/verification',
      '/family/account',
      '/family/settings',
    ]);
  });
});
