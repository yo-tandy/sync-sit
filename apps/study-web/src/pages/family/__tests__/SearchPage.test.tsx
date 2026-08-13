import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The search page loads families/{id} for the
// caller's saved address/latLng (getDoc), then calls the searchTutors callable
// (httpsCallable) with {subject, level, latLng?, filters?}.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
    userDoc: null as unknown,
  },
  familyData: null as Record<string, unknown> | null,
  getDoc: vi.fn(),
  // searchTutors callable: (name, payload) => Promise<{ data }>. Reassigned per test.
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { SearchPage } from '../SearchPage';

function parent(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'p1',
    firstName: 'Dana',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1', ...overrides } },
  };
}

function tutorResult(overrides: Record<string, unknown> = {}) {
  return {
    uid: 't1',
    firstName: 'Alex',
    lastName: 'Roy',
    languages: ['fr'],
    classLevel: 'Terminale',
    subject: 'math',
    level: '6e',
    rate: 25,
    levels: ['6e'],
    sessionLengthsMin: [60],
    locationPrefs: ['online'],
    distance: 3.4,
    endorsementCount: 2,
    requestStatus: 'none',
    ...overrides,
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 'p1' };
  h.auth.userDoc = parent();
  h.familyData = { familyName: 'Cohen', address: '1 Rue de Paris', latLng: { lat: 48, lng: 2 } };
  h.getDoc.mockReset();
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.familyData != null, data: () => h.familyData }),
  );
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { results: [] } });
}

describe('family SearchPage', () => {
  beforeEach(() => reset());

  it('sends {subject, level, latLng, filters} to searchTutors on submit', async () => {
    h.callable.mockResolvedValue({ data: { results: [tutorResult()] } });
    renderWithProviders(<SearchPage />);
    // Wait for the family doc (address/latLng) to load.
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'math' } });
    fireEvent.change(screen.getByLabelText(/level/i), { target: { value: '6e' } });
    fireEvent.change(screen.getByLabelText(/max rate/i), { target: { value: '30' } });

    fireEvent.click(screen.getByRole('button', { name: /search tutors/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'searchTutors',
        expect.objectContaining({
          subject: 'math',
          level: '6e',
          latLng: { lat: 48, lng: 2 },
          filters: expect.objectContaining({ maxRate: 30 }),
        }),
      ),
    );
  });

  it('auto-searches once on mount when ?subject= & ?level= are both valid', async () => {
    const { rerender } = renderWithProviders(
      <SearchPage />,
      '/family/search?subject=math&level=6e',
    );

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'searchTutors',
        expect.objectContaining({ subject: 'math', level: '6e', latLng: { lat: 48, lng: 2 } }),
      ),
    );

    // A re-render must NOT re-trigger the auto-search (once-only guard).
    rerender(<SearchPage />);
    await waitFor(() => expect(h.callable).toHaveBeenCalledTimes(1));
  });

  it('seeds the address input from the family doc', async () => {
    renderWithProviders(<SearchPage />);
    expect(await screen.findByDisplayValue('1 Rue de Paris')).toBeInTheDocument();
  });

  it('omits `filters` from the payload when no optional filter is set', async () => {
    renderWithProviders(<SearchPage />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'math' } });
    fireEvent.change(screen.getByLabelText(/level/i), { target: { value: '6e' } });
    fireEvent.click(screen.getByRole('button', { name: /search tutors/i }));

    await waitFor(() => expect(h.callable).toHaveBeenCalled());
    const payload = h.callable.mock.calls[0][1];
    expect(payload).not.toHaveProperty('filters');
    // latLng is still seeded from the family doc — only `filters` is dropped.
    expect(payload).toMatchObject({ subject: 'math', level: '6e', latLng: { lat: 48, lng: 2 } });
  });

  it('does NOT auto-search when the query params are invalid', async () => {
    renderWithProviders(<SearchPage />, '/family/search?subject=notasubject&level=zzz');
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
    expect(h.callable).not.toHaveBeenCalled();
  });

  it('renders the verification-required copy on permission-denied', async () => {
    h.callable.mockRejectedValue({ code: 'functions/permission-denied' });
    renderWithProviders(<SearchPage />, '/family/search?subject=math&level=6e');

    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
  });

  it('shows the empty state when no tutors match', async () => {
    h.callable.mockResolvedValue({ data: { results: [] } });
    renderWithProviders(<SearchPage />, '/family/search?subject=math&level=6e');

    expect(await screen.findByText(/no tutors found/i)).toBeInTheDocument();
  });

  it('empty results offer clear-filters ONLY when a filter is set, and clearing re-runs the search', async () => {
    h.callable.mockResolvedValue({ data: { results: [] } });
    renderWithProviders(<SearchPage />, '/family/search?subject=math&level=6e');
    await screen.findByText(/no tutors found/i);

    // No optional filters set: the action would be a visible no-op, so the
    // empty state withholds it (icon + message only).
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/max rate/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    // All optional filters cleared; the mandatory subject/level inputs stay.
    expect(screen.getByLabelText(/max rate/i)).toHaveValue(null);
    expect(screen.getByLabelText(/max distance/i)).toHaveValue(null);
    expect(screen.getByLabelText(/subject/i)).toHaveValue('math');
    expect(screen.getByLabelText(/level/i)).toHaveValue('6e');

    // And the search re-ran with the CLEARED values (not the stale closure):
    // second call carries no filters key at all.
    await waitFor(() => expect(h.callable).toHaveBeenCalledTimes(2));
    const lastPayload = h.callable.mock.calls[1][1] as Record<string, unknown>;
    expect(lastPayload).toEqual(
      expect.objectContaining({ subject: 'math', level: '6e' }),
    );
    expect(lastPayload).not.toHaveProperty('filters');
  });

  it('renders a result row with name, rate and endorsement count', async () => {
    h.callable.mockResolvedValue({ data: { results: [tutorResult()] } });
    renderWithProviders(<SearchPage />, '/family/search?subject=math&level=6e');

    expect(await screen.findByText(/Alex/)).toBeInTheDocument();
    expect(screen.getByText(/25 €\/h/)).toBeInTheDocument();
    expect(screen.getByText(/2 endorsements/)).toBeInTheDocument();
  });
});
