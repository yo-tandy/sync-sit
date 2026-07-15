import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. RequestsPage reads studyContactRequests
// where familyId==mine orderBy createdAt desc (composite index exists) and
// groups the rows by status.
const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  requests: [] as Record<string, unknown>[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  getDocs: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  orderBy: (...args: [string, string]) => h.orderBy(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { RequestsPage } from '../RequestsPage';

function ts(iso: string) {
  return { seconds: 0, nanoseconds: 0, toDate: () => new Date(iso) };
}

function reqDoc(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'r1',
    tutorUserId: 't1',
    familyId: 'fam1',
    tutorName: 'Alex Roy',
    subject: 'math',
    level: '6e',
    status: 'pending',
    createdAt: ts('2026-07-10'),
    ...overrides,
  };
}

function reset() {
  h.auth.userDoc = {
    uid: 'p1',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
  h.requests = [];
  h.where.mockClear();
  h.orderBy.mockClear();
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.requests.map((r) => ({ id: r.requestId, data: () => r })) }),
  );
}

describe('family RequestsPage', () => {
  beforeEach(() => reset());

  it('queries studyContactRequests for the family, newest first', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
    expect(h.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    const collectionArg = h.getDocs.mock.calls[0][0].query[0];
    expect(collectionArg.path).toBe('studyContactRequests');
  });

  it('groups requests by status (pending / accepted / declined)', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', tutorName: 'Pending Tutor', status: 'pending' }),
      reqDoc({ requestId: 'r2', tutorName: 'Accepted Tutor', status: 'accepted' }),
      reqDoc({ requestId: 'r3', tutorName: 'Declined Tutor', status: 'declined' }),
    ];
    renderWithProviders(<RequestsPage />);

    expect(await screen.findByText(/Pending Tutor/)).toBeInTheDocument();
    expect(screen.getByText(/Accepted Tutor/)).toBeInTheDocument();
    expect(screen.getByText(/Declined Tutor/)).toBeInTheDocument();
  });

  it('renders subject taxonomy label + level for a row', async () => {
    h.requests = [reqDoc({ subject: 'math', level: '6e' })];
    renderWithProviders(<RequestsPage />);
    // 'math' resolves to its tutor.subjects.names.math label (EN: "Maths").
    expect(await screen.findByText(/6e/)).toBeInTheDocument();
  });

  it('accepted rows deep-link to the search page with subject & level prefilled', async () => {
    h.requests = [reqDoc({ status: 'accepted', subject: 'physics', level: '2nde' })];
    renderWithProviders(<RequestsPage />);
    const link = await screen.findByRole('link', { name: /view contact details/i });
    expect(link).toHaveAttribute('href', '/family/search?subject=physics&level=2nde');
  });

  it('non-accepted rows have no view-contact deep-link', async () => {
    h.requests = [reqDoc({ status: 'pending' })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);
    expect(screen.queryByRole('link', { name: /view contact details/i })).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no requests', async () => {
    h.requests = [];
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
  });

  it('resolves to the empty state (no permanent spinner) when there is no familyId', async () => {
    h.auth.userDoc = { uid: 'p1', profiles: { parent: { enrollmentComplete: true } } };
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(h.getDocs).not.toHaveBeenCalled();
  });

  it('formats a plain Date createdAt (emulator rows) instead of blanking it', async () => {
    h.requests = [reqDoc({ createdAt: new Date('2026-07-10T12:00:00') })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});
