import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * Direct tutor lookup by personal code (issue #235, parity A2): the entry
 * point on the family SearchPage and the TutorLookup flow — code → lookupTutor
 * callable → offering pickers → the shared TutorCard. The search flow itself
 * stays pinned in SearchPage.test.tsx; the card's CTA behavior in its own
 * component and integration coverage.
 */

const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
    userDoc: null as unknown,
  },
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  callable: vi.fn(),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  onSnapshot: () => h.unsub,
  deleteDoc: () => Promise.resolve(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { SearchPage } from '../SearchPage';
import { TutorLookup } from '@/components/family/TutorLookup';

function lookupResult(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'tut1',
    firstName: 'Yael',
    lastName: 'Cohen',
    languages: ['French'],
    classLevel: 'L3',
    subjects: [
      { subject: 'math', levels: ['6e', '5e'], rate: 25 },
      { subject: 'english', levels: ['3e'], rate: 22 },
    ],
    sessionLengthsMin: [60],
    locationPrefs: ['online'],
    distance: null,
    endorsementCount: 0,
    cancellationNoticeHours: 0,
    requestStatus: 'none',
    ...overrides,
  };
}

async function lookup(code = '4F7A2C9B') {
  fireEvent.change(screen.getByLabelText('Tutor code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Find tutor' }));
  await waitFor(() => expect(h.callable).toHaveBeenCalledWith('lookupTutor', { code }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.userDoc = {
    uid: 'p1',
    firstName: 'Dana',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
  h.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  h.getDocs.mockResolvedValue({ docs: [] });
  h.callable.mockResolvedValue({ data: { result: lookupResult() } });
});

describe('SearchPage lookup entry point (issue #235)', () => {
  it('renders the code-lookup card on the search page', async () => {
    renderWithProviders(<SearchPage />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
    expect(screen.getByText('Already know a tutor?')).toBeTruthy();
    expect(screen.getByLabelText('Tutor code')).toBeTruthy();
  });
});

describe('TutorLookup flow (issue #235)', () => {
  it('resolves a code and renders the card with the first offering preselected', async () => {
    renderWithProviders(<TutorLookup />);
    await lookup();

    // Card identity + the default (first) offering's subject/level/rate.
    await waitFor(() => expect(screen.getByText(/Yael/)).toBeTruthy());
    expect((screen.getByLabelText('Subject') as HTMLSelectElement).value).toBe('math');
    expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('6e');
    expect(screen.getByText('25 €/h')).toBeTruthy();
    // The normal consent-gated CTA — the same request flow search results use.
    expect(screen.getByRole('button', { name: 'Request contact' })).toBeTruthy();
  });

  it('switching subject resets the level to the new offering\'s first and re-rates', async () => {
    renderWithProviders(<TutorLookup />);
    await lookup();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'english' } });
    expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('3e');
    await waitFor(() => expect(screen.getByText('22 €/h')).toBeTruthy());
  });

  it('sends the code as typed — the server owns normalization', async () => {
    renderWithProviders(<TutorLookup />);
    await lookup('4f7a-2c9b');
    await waitFor(() => expect(screen.getByText(/Yael/)).toBeTruthy());
  });

  it('shows the uniform not-found copy (unknown code OR hidden tutor)', async () => {
    h.callable.mockRejectedValue(
      Object.assign(new Error('nf'), { code: 'functions/not-found' }),
    );
    renderWithProviders(<TutorLookup />);
    await lookup();
    await waitFor(() => expect(screen.getByText(/No tutor found for this code/)).toBeTruthy());
  });

  it('shows the format copy on invalid-argument', async () => {
    h.callable.mockRejectedValue(
      Object.assign(new Error('bad'), { code: 'functions/invalid-argument' }),
    );
    renderWithProviders(<TutorLookup />);
    await lookup('AAAABBBB');
    await waitFor(() =>
      expect(screen.getByText(/doesn't look like a tutor code/)).toBeTruthy(),
    );
  });

  it('shows the verification recovery banner on permission-denied', async () => {
    h.callable.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
    );
    renderWithProviders(<TutorLookup />);
    await lookup();
    await waitFor(() => expect(screen.getByText('Complete verification')).toBeTruthy());
  });

  it('clears a previous result and error when a new lookup runs', async () => {
    renderWithProviders(<TutorLookup />);
    await lookup();
    await waitFor(() => expect(screen.getByText(/Yael/)).toBeTruthy());

    h.callable.mockRejectedValue(
      Object.assign(new Error('nf'), { code: 'functions/not-found' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find tutor' }));
    await waitFor(() => expect(screen.getByText(/No tutor found for this code/)).toBeTruthy());
    expect(screen.queryByText(/Yael/)).toBeNull();
  });
});
