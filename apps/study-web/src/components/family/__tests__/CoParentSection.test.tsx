import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * The container half of the co-parent move (issue #340). The presentation is
 * covered by __tests__/shared-ui/CoParentSettings.test.tsx; what only a
 * container test can pin is the cross-app decision (PR #343 round 4):
 *
 *   study's invite link must target SIT_APP_URL, NOT study's own origin.
 *
 * That is the single most surprising line in this PR and the one a future
 * refactor is most likely to "correct" by pasting sit's window.location.origin
 * — at which point the link 404s, silently, for every co-parent invited from
 * study. Joining a family is a sit-side flow; the family record is shared.
 */
const h = vi.hoisted(() => ({
  callable: vi.fn(),
  familyData: { parentIds: ['me', 'other'] } as Record<string, unknown> | null,
  userDocs: {
    me: { firstName: 'Claire', lastName: 'Moreau' },
    other: { firstName: 'Marc', lastName: 'Moreau' },
  } as Record<string, { firstName: string; lastName: string } | undefined>,
  getDocImpl: null as null | ((path: string) => unknown),
}));

vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => h.callable }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
  getDoc: async (ref: { path: string }) => {
    if (h.getDocImpl) return h.getDocImpl(ref.path) as never;
    const [col, id] = ref.path.split('/');
    if (col === 'families') {
      return { exists: () => h.familyData !== null, data: () => h.familyData };
    }
    const u = h.userDocs[id];
    return { exists: () => !!u, data: () => u };
  },
}));
vi.mock('@/stores/authStore', () => {
  const state = { userDoc: { uid: 'me', profiles: { parent: { familyId: 'fam1' } } } };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { renderWithProviders } from '@/__tests__/test-utils';
import { SIT_APP_URL } from '@/utils/appSwitch';
import { CoParentSection } from '../CoParentSection';

beforeEach(() => {
  h.callable.mockReset();
  h.getDocImpl = null;
  h.familyData = { parentIds: ['me', 'other'] };
  h.userDocs = {
    me: { firstName: 'Claire', lastName: 'Moreau' },
    other: { firstName: 'Marc', lastName: 'Moreau' },
  };
});

describe('study CoParentSection (issue #340)', () => {
  it('builds the invite link against sync-sit, not study’s own origin', async () => {
    h.callable.mockResolvedValue({ data: { token: 'tok123' } });
    renderWithProviders(<CoParentSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Generate invite link' }));

    const link = await screen.findByText(/\/invite\/tok123$/);
    expect(link.textContent).toBe(`${SIT_APP_URL}/invite/tok123`);
    // The failure this guards against is a link built from the wrong origin,
    // so assert the negative too — jsdom serves the page from localhost.
    expect(link.textContent).not.toContain(window.location.origin);
  });

  it('lists the family members and marks the signed-in parent', async () => {
    renderWithProviders(<CoParentSection />);
    expect(await screen.findByText('Marc Moreau')).toBeInTheDocument();
    expect(screen.getByText('Claire Moreau')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });

  it('names a member whose user doc is missing with the singular fallback', async () => {
    h.userDocs = { me: { firstName: 'Claire', lastName: 'Moreau' }, other: undefined };
    renderWithProviders(<CoParentSection />);
    // Not the plural section heading "Family members", which read as a bug.
    expect(await screen.findByText('Family member')).toBeInTheDocument();
  });

  it('reports a failed member load instead of showing an empty list', async () => {
    h.getDocImpl = (path: string) => {
      if (path.startsWith('families/')) throw new Error('permission-denied');
      return { exists: () => false, data: () => undefined };
    };
    renderWithProviders(<CoParentSection />);
    // Without the container's catch this rendered the members heading over an
    // empty list, and the rejection escaped the effect unhandled.
    // Query the text, not role=alert: ToastProvider mounts its own sr-only
    // live region, so a role query matches several elements.
    expect(await screen.findByText('An error occurred')).toBeInTheDocument();
  });

  it('reports a failed link generation', async () => {
    h.callable.mockRejectedValue(new Error('Boom'));
    renderWithProviders(<CoParentSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate invite link' }));
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument());
  });
});
