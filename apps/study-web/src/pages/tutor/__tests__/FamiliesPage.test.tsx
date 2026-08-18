import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The tutor FamiliesPage subscribes to
// studyContactRequests where tutorUserId==me via onSnapshot (the same provable
// equality query as RequestsPage) and derives "my families" from the
// accepted-status rows — the client-readable projection of
// profiles.tutor.approvedFamilies.
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };
const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 't1' } as { uid: string } | null },
  requests: [] as Record<string, unknown>[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

// Partial mock: keep the real router (Link, MemoryRouter) but capture
// programmatic navigation so the propose CTA's target is assertable.
vi.mock('react-router', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router')>();
  return { ...orig, useNavigate: () => h.navigate };
});

import { FamiliesPage } from '../FamiliesPage';

function ts(seconds: number) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function reqDoc(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'r1',
    tutorUserId: 't1',
    familyId: 'fam1',
    familyName: 'Cohen',
    parentName: 'Dana Weiss',
    tutorName: 'Alex Roy',
    subject: 'math',
    level: '6e',
    status: 'accepted',
    createdAt: ts(1_700_000_000),
    respondedAt: ts(1_700_100_000),
    ...overrides,
  };
}

function snapOf(rows: Record<string, unknown>[]): Snapshot {
  return { docs: rows.map((r) => ({ id: r.requestId as string, data: () => r })) };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.requests = [];
  h.where.mockClear();
  h.unsubscribe.mockClear();
  h.navigate.mockClear();
  h.onSnapshot.mockReset();
  h.onSnapshot.mockImplementation((query: unknown, next: (snap: Snapshot) => void) => {
    void query;
    next(snapOf(h.requests));
    return h.unsubscribe;
  });
}

describe('tutor FamiliesPage', () => {
  beforeEach(() => reset());

  it('subscribes to studyContactRequests for the signed-in tutor (provable equality query)', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<FamiliesPage />);
    await screen.findByText(/Cohen/);

    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    const collectionArg = (h.onSnapshot.mock.calls[0][0] as { query: { path: string }[] })
      .query[0];
    expect(collectionArg.path).toBe('studyContactRequests');
  });

  it('renders approved families with name, parent, subject/level and since-date', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<FamiliesPage />);

    expect(await screen.findByText(/Cohen/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Weiss/)).toBeInTheDocument();
    expect(screen.getByText(/6e/)).toBeInTheDocument();
    // respondedAt (1_700_100_000s = Nov 2023) formats to a real date, not ''.
    expect(screen.getByText(/2023/)).toBeInTheDocument();
  });

  it('gates on approval: pending, declined and cancelled families never render', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', familyId: 'famA', familyName: 'Approved Fam', status: 'accepted' }),
      reqDoc({ requestId: 'r2', familyId: 'famP', familyName: 'Pending Fam', status: 'pending' }),
      reqDoc({ requestId: 'r3', familyId: 'famD', familyName: 'Declined Fam', status: 'declined' }),
      reqDoc({ requestId: 'r4', familyId: 'famC', familyName: 'Cancelled Fam', status: 'cancelled' }),
    ];
    renderWithProviders(<FamiliesPage />);

    expect(await screen.findByText(/Approved Fam/)).toBeInTheDocument();
    // The approvedFamilies projection: an unapproved relationship exposes
    // NOTHING on this page — not even the denormalized names.
    expect(screen.queryByText(/Pending Fam/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Fam/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cancelled Fam/)).not.toBeInTheDocument();
  });

  it('never renders contact fields — only the denormalized name fields', async () => {
    // Even if a (hypothetical) doc carried contact-ish fields, the page renders
    // only familyName/parentName/subject/level/date. Pin: no email/phone text.
    h.requests = [
      reqDoc({ contactEmail: 'parent@example.com', contactPhone: '+33612345678' }),
    ];
    renderWithProviders(<FamiliesPage />);
    await screen.findByText(/Cohen/);

    expect(screen.queryByText(/parent@example.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+33612345678/)).not.toBeInTheDocument();
  });

  it('dedupes by familyId, keeping the newest relationship', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', familyId: 'fam1', familyName: 'Cohen', respondedAt: ts(1_700_100_000) }),
      reqDoc({ requestId: 'r2', familyId: 'fam1', familyName: 'Cohen', respondedAt: ts(1_700_200_000) }),
    ];
    renderWithProviders(<FamiliesPage />);
    await screen.findByText(/Cohen/);

    expect(screen.getAllByText(/Cohen/)).toHaveLength(1);
  });

  it('shows the empty state with a link to requests when no family is approved', async () => {
    // A pending request alone is NOT a family yet.
    h.requests = [reqDoc({ status: 'pending' })];
    renderWithProviders(<FamiliesPage />);

    expect(await screen.findByText(/no families yet/i)).toBeInTheDocument();
    const action = screen.getByRole('link', { name: /review your requests/i });
    expect(action).toHaveAttribute('href', '/tutor/requests');
  });

  it('surfaces a load error when the subscription errors — not an empty list', async () => {
    h.onSnapshot.mockImplementation(
      (_query: unknown, _next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
        error(new Error('permission-denied'));
        return h.unsubscribe;
      },
    );
    renderWithProviders(<FamiliesPage />);

    expect(await screen.findByText(/could not load your families/i)).toBeInTheDocument();
    expect(screen.queryByText(/no families yet/i)).not.toBeInTheDocument();
  });

  it('offers "Propose a session" per family, navigating to /tutor/propose/:familyId', async () => {
    h.requests = [reqDoc({ familyId: 'famX', familyName: 'Cohen', subject: 'math', level: '6e' })];
    renderWithProviders(<FamiliesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /propose a session/i }));
    expect(h.navigate).toHaveBeenCalledWith('/tutor/propose/famX', {
      state: { familyName: 'Cohen', subject: 'math', level: '6e' },
    });
  });

  it('unsubscribes the listener on unmount', async () => {
    h.requests = [reqDoc()];
    const { unmount } = renderWithProviders(<FamiliesPage />);
    await screen.findByText(/Cohen/);

    unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
