import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';

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

  it('translates a failed link generation instead of echoing server text', async () => {
    // The previous version of this test asserted the RAW message and so pinned
    // the defect rather than the fix (PR #343 round 5): a FunctionsError is an
    // Error, so `err instanceof Error ? err.message : fallback` always echoed
    // the callable's English-only string and the fallback key was unreachable.
    h.callable.mockRejectedValue(
      Object.assign(new Error('You are not a member of this family'), {
        code: 'functions/permission-denied',
      }),
    );
    renderWithProviders(<CoParentSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate invite link' }));
    expect(
      await screen.findByText('You do not have permission to invite a co-parent to this family.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('You are not a member of this family')).toBeNull();
  });

  it('maps each generate error code to its own message, with a real fallback', async () => {
    const cases: [string | undefined, string][] = [
      ['functions/not-found', 'Your family could not be found. Please reload and try again.'],
      ['functions/internal', 'Could not generate an invite link. Please try again.'],
      // No code at all (a plain throw) must still reach the fallback, not blank.
      [undefined, 'Could not generate an invite link. Please try again.'],
    ];
    for (const [code, expected] of cases) {
      h.callable.mockReset();
      const err = new Error('server text');
      if (code) Object.assign(err, { code });
      h.callable.mockRejectedValue(err);
      renderWithProviders(<CoParentSection />);
      fireEvent.click(await screen.findByRole('button', { name: 'Generate invite link' }));
      expect(await screen.findByText(expected)).toBeInTheDocument();
      cleanup();
    }
  });
});
