import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { TutorLookup, type TutorLookupResult } from '../TutorLookup';

/**
 * "Already know your tutor?" lookup section (issue #235) — debounced
 * lookupTutor calls, per-status rendering (searchTutors' incoming idiom),
 * and the subject/level-selecting request dialog that goes through the
 * ordinary sendTutorContactRequest flow.
 */
const h = vi.hoisted(() => ({
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

function tutor(overrides: Partial<TutorLookupResult> = {}): TutorLookupResult {
  return {
    uid: 't1',
    firstName: 'Yael',
    lastName: 'Cohen',
    photoUrl: null,
    classLevel: 'L3',
    languages: ['French'],
    subjects: [
      { subject: 'math', levels: ['6e', '5e'] },
      { subject: 'english', levels: ['6e'] },
    ],
    requestStatus: 'none',
    ...overrides,
  };
}

async function typeAndResolve(results: TutorLookupResult[]) {
  h.callable.mockResolvedValue({ data: { results } });
  renderWithProviders(<TutorLookup />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'yael' } });
  await waitFor(() =>
    expect(h.callable).toHaveBeenCalledWith('lookupTutor', { query: 'yael' }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('TutorLookup', () => {
  it('does not call the backend for a sub-2-character query', async () => {
    renderWithProviders(<TutorLookup />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'y' } });
    // Give the (never-scheduled) debounce a chance to misfire.
    await new Promise((r) => setTimeout(r, 500));
    expect(h.callable).not.toHaveBeenCalled();
  });

  it('debounce-searches and renders a result row', async () => {
    await typeAndResolve([tutor()]);
    await waitFor(() => expect(screen.getByText('Yael Cohen')).toBeInTheDocument());
    expect(screen.getByText(/L3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request contact' })).toBeInTheDocument();
  });

  it('renders an empty-state message when nothing matches', async () => {
    await typeAndResolve([]);
    await waitFor(() => expect(screen.getByText('No tutors found')).toBeInTheDocument());
  });

  it('says the list is partial when the server reports truncation', async () => {
    h.callable.mockResolvedValue({ data: { results: [tutor()], truncated: true } });
    renderWithProviders(<TutorLookup />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'yael' } });
    await waitFor(() => expect(screen.getByText(/first 10 matches/)).toBeInTheDocument());
  });

  it('renders pending / incoming / accepted statuses without a send CTA', async () => {
    await typeAndResolve([
      tutor({ uid: 'p', firstName: 'Pending', requestStatus: 'pending' }),
      tutor({ uid: 'i', firstName: 'Incoming', requestStatus: 'incoming' }),
      tutor({ uid: 'a', firstName: 'Accepted', requestStatus: 'accepted' }),
    ]);
    await waitFor(() => expect(screen.getByText('Request pending')).toBeInTheDocument());
    // Incoming points at the requests page where Accept lives — never a send CTA.
    const incoming = screen.getByText('They contacted you — respond');
    expect(incoming.closest('a')).toHaveAttribute('href', '/family/requests');
    expect(screen.getByText('Connected')).toBeInTheDocument();
    // Connected is not a dead end: the contact link points at the requests
    // page where the revealed details live (round-3 catch).
    expect(screen.getByText('View contact').closest('a')).toHaveAttribute('href', '/family/requests');
    expect(screen.queryByRole('button', { name: 'Request contact' })).not.toBeInTheDocument();
  });

  it('sends a contact request with the CHOSEN subject/level and flips the row to pending', async () => {
    await typeAndResolve([tutor()]);
    await waitFor(() => expect(screen.getByText('Yael Cohen')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Request contact' }));

    // Subject select drives the level options: english offers only 6e.
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'english' } });
    await waitFor(() => {
      const levelOptions = (selects[1] as HTMLSelectElement).options;
      expect(Array.from(levelOptions).map((o) => o.value)).toEqual(['6e']);
    });

    h.callable.mockResolvedValueOnce({ data: { success: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('sendTutorContactRequest', {
        tutorUserId: 't1',
        subject: 'english',
        level: '6e',
        // empty message omitted, mirroring TutorCard's dialog
      }),
    );
    await waitFor(() => expect(screen.getByText('Request pending')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Request contact' })).not.toBeInTheDocument();
  });

  it('clears the Searching indicator when the query drops under 2 chars mid-debounce', async () => {
    // PR #254 round 1: the early return skipped setSearching(false), so
    // "Searching..." stuck permanently after ya -> backspace within 400ms.
    renderWithProviders(<TutorLookup />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'ya' } });
    expect(screen.getByText('Searching...')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'y' } });
    expect(screen.queryByText('Searching...')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText('Searching...')).not.toBeInTheDocument();
    expect(h.callable).not.toHaveBeenCalled();
  });

  it('a failed lookup clears the previous rows and shows the error line', async () => {
    // PR #254 round 1: the bare catch left the PREVIOUS query's rows
    // standing as though they answered the new one.
    await typeAndResolve([tutor()]);
    await waitFor(() => expect(screen.getByText('Yael Cohen')).toBeInTheDocument());
    h.callable.mockRejectedValue(new Error('offline'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'yael xyz' } });
    await waitFor(() => expect(screen.queryByText('Yael Cohen')).not.toBeInTheDocument());
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('renders a declined pair as Request again with the cooldown hint', async () => {
    await typeAndResolve([tutor({ requestStatus: 'declined' })]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request again' })).toBeInTheDocument());
    expect(screen.getByText(/recently declined/)).toBeInTheDocument();
    // The retry CTA opens the same dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Request again' }));
    expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
  });

  it('maps permission-denied to the verification copy (unverified families reach this dialog)', async () => {
    await typeAndResolve([tutor()]);
    await waitFor(() => expect(screen.getByText('Yael Cohen')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Request contact' }));
    h.callable.mockRejectedValueOnce({ code: 'functions/permission-denied' });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(screen.getByText(/needs to be verified/)).toBeInTheDocument(),
    );
  });

  it('discards a stale in-flight response that resolves AFTER a newer query (out-of-order)', async () => {
    // The pre-debounce cancel path is pinned above; this is the other half
    // of the seq guard (PR #254 round 2): call A ("yae") still in flight
    // when call B ("yael x") fires and resolves first -- A resolving late
    // must not overwrite B's rows.
    let resolveA!: (v: unknown) => void;
    const slowA = new Promise((r) => { resolveA = r; });
    h.callable
      .mockImplementationOnce(() => slowA)
      .mockImplementationOnce(() =>
        Promise.resolve({ data: { results: [tutor({ uid: 'b', firstName: 'Newer' })] } }),
      );
    renderWithProviders(<TutorLookup />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'yae' } });
    await waitFor(() => expect(h.callable).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'yael x' } });
    await waitFor(() => expect(h.callable).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Newer Cohen')).toBeInTheDocument());
    // The stale response lands late -- and changes nothing.
    resolveA({ data: { results: [tutor({ uid: 'a', firstName: 'Stale' })] } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Stale Cohen')).not.toBeInTheDocument();
    expect(screen.getByText('Newer Cohen')).toBeInTheDocument();
  });

  it('shows the dedicated throttle copy on resource-exhausted, not the generic error', async () => {
    h.callable.mockRejectedValue({ code: 'functions/resource-exhausted' });
    renderWithProviders(<TutorLookup />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'yael' } });
    await waitFor(() =>
      expect(screen.getByText(/Too many searches/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('surfaces the already-exists error copy instead of closing the dialog', async () => {
    await typeAndResolve([tutor()]);
    await waitFor(() => expect(screen.getByText('Yael Cohen')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Request contact' }));
    h.callable.mockRejectedValueOnce({ code: 'functions/already-exists' });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(screen.getByText(/already have a pending request/i)).toBeInTheDocument(),
    );
  });
});
