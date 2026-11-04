import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * Direct tutor lookup by name/email/phone (issue #437), replacing the
 * personal-code flow (issue #235): the entry point on the family SearchPage
 * and the TutorLookup flow — debounced query → lookupTutor callable → a
 * list of results, each with its own offering pickers → the shared
 * TutorCard. The search flow itself stays pinned in SearchPage.test.tsx;
 * the card's CTA behavior in its own component and integration coverage.
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

async function search(query = 'Yael') {
  fireEvent.change(screen.getByLabelText('Search by name, email or phone...'), {
    target: { value: query },
  });
  await waitFor(() => expect(h.callable).toHaveBeenCalledWith('lookupTutor', { query }), {
    timeout: 2000,
  });
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
  h.callable.mockResolvedValue({ data: { results: [lookupResult()] } });
});

describe('SearchPage lookup entry point (issue #437)', () => {
  it('renders the identity-lookup card on the search page', async () => {
    renderWithProviders(<SearchPage />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
    expect(screen.getByText('Already know a tutor?')).toBeTruthy();
    expect(screen.getByLabelText('Search by name, email or phone...')).toBeTruthy();
  });
});

describe('TutorLookup flow (issue #437)', () => {
  it('finds a tutor and renders the card with the first offering preselected', async () => {
    renderWithProviders(<TutorLookup />);
    await search();

    // Card identity + the default (first) offering's subject/level/rate.
    await waitFor(() => expect(screen.getByText(/Yael/)).toBeTruthy());
    expect((screen.getByLabelText('Subject') as HTMLSelectElement).value).toBe('math');
    expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('6e');
    expect(screen.getByText('25 €/h')).toBeTruthy();
    // The normal consent-gated CTA — the same request flow search results use.
    expect(screen.getByRole('button', { name: 'Request contact' })).toBeTruthy();
  });

  it('renders one card per match, each with independent subject/level state', async () => {
    h.callable.mockResolvedValue({
      data: {
        results: [
          lookupResult({ uid: 'tut1', firstName: 'Yael' }),
          lookupResult({
            uid: 'tut2',
            firstName: 'Noa',
            subjects: [{ subject: 'physics', levels: ['4e'], rate: 30 }],
          }),
        ],
      },
    });
    renderWithProviders(<TutorLookup />);
    await search();

    await waitFor(() => expect(screen.getByText(/Yael/)).toBeTruthy());
    expect(screen.getByText(/Noa/)).toBeTruthy();
    const subjectSelects = screen.getAllByLabelText('Subject') as HTMLSelectElement[];
    expect(subjectSelects.map((s) => s.value)).toEqual(['math', 'physics']);

    // Switching the FIRST result's subject must not disturb the second's.
    fireEvent.change(subjectSelects[0], { target: { value: 'english' } });
    expect((screen.getAllByLabelText('Subject')[1] as HTMLSelectElement).value).toBe('physics');
  });

  it('switching subject resets the level to the new offering\'s first and re-rates', async () => {
    renderWithProviders(<TutorLookup />);
    await search();
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'english' } });
    expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('3e');
    await waitFor(() => expect(screen.getByText('22 €/h')).toBeTruthy());
  });

  it('does not search until the query reaches 2 characters', async () => {
    renderWithProviders(<TutorLookup />);
    fireEvent.change(screen.getByLabelText('Search by name, email or phone...'), {
      target: { value: 'Y' },
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(h.callable).not.toHaveBeenCalled();
  });

  it('shows the no-results copy for a well-formed query with no matches', async () => {
    h.callable.mockResolvedValue({ data: { results: [] } });
    renderWithProviders(<TutorLookup />);
    await search('nonexistentperson');
    await waitFor(() => expect(screen.getByText('No tutors found')).toBeTruthy());
  });

  it('shows the verification recovery banner on permission-denied', async () => {
    h.callable.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
    );
    renderWithProviders(<TutorLookup />);
    await search();
    await waitFor(() => expect(screen.getByText('Complete verification')).toBeTruthy());
  });

  it('clears a previous result set when a new search runs', async () => {
    renderWithProviders(<TutorLookup />);
    await search();
    await waitFor(() => expect(screen.getByText(/Yael/)).toBeTruthy());

    h.callable.mockResolvedValue({ data: { results: [] } });
    fireEvent.change(screen.getByLabelText('Search by name, email or phone...'), {
      target: { value: 'nonexistentperson' },
    });
    await waitFor(() => expect(screen.getByText('No tutors found')).toBeTruthy());
    expect(screen.queryByText(/Yael/)).toBeNull();
  });
});
