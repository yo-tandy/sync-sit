import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The tutor RequestsPage reads
// studyContactRequests where tutorUserId==me (sorted client-side, see the
// component note) and responds via the respondToTutorContactRequest callable.
const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 't1' } as { uid: string } | null },
  requests: [] as Record<string, unknown>[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  getDocs: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { RequestsPage } from '../RequestsPage';

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
    message: 'Looking for weekly help.',
    status: 'pending',
    createdAt: ts(1_700_000_000),
    ...overrides,
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.requests = [];
  h.where.mockClear();
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.requests.map((r) => ({ id: r.requestId, data: () => r })) }),
  );
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { success: true } });
}

describe('tutor RequestsPage', () => {
  beforeEach(() => reset());

  it('queries studyContactRequests for the signed-in tutor', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Cohen/);

    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    const collectionArg = h.getDocs.mock.calls[0][0].query[0];
    expect(collectionArg.path).toBe('studyContactRequests');
  });

  it('renders a pending request with family, parent, subject/level and message', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);

    expect(await screen.findByText(/Cohen/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Weiss/)).toBeInTheDocument();
    expect(screen.getByText(/6e/)).toBeInTheDocument();
    expect(screen.getByText(/Looking for weekly help/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('accept → respondToTutorContactRequest({requestId, action:accept})', async () => {
    h.requests = [reqDoc({ requestId: 'rA' })];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorContactRequest', {
        requestId: 'rA',
        action: 'accept',
      }),
    );
  });

  it('decline requires confirmation, then sends action:decline', async () => {
    h.requests = [reqDoc({ requestId: 'rD' })];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^decline$/i }));

    // Confirm dialog — nothing sent until confirmed.
    expect(h.callable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorContactRequest', {
        requestId: 'rD',
        action: 'decline',
      }),
    );
  });

  it('optimistically removes the Accept/Decline buttons after accepting', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument(),
    );
  });

  it('rolls back the optimistic flip and shows an error when the callable fails', async () => {
    h.callable.mockRejectedValue({ code: 'functions/internal' });
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // Error surfaced and the pending actions come back.
    expect(await screen.findByText(/couldn.?t update|something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
  });

  it('history rows (accepted/declined) are read-only', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', familyName: 'Accepted Fam', status: 'accepted' }),
      reqDoc({ requestId: 'r2', familyName: 'Declined Fam', status: 'declined' }),
    ];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Accepted Fam/);

    expect(screen.getByText(/Declined Fam/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument();
  });
});
