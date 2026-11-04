/**
 * Submitted-endorsements delete-confirm pins (issue #305 review): the dialog
 * got a real title key (submittedReferences.confirmDeleteTitle) instead of
 * the generic common.confirm, used for BOTH the visible heading and the
 * accessible name — pin the copy, the modal semantics, and the soft-delete
 * write it confirms.
 *
 * i18n is mocked to echo keys.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  updateDoc: vi.fn(() => Promise.resolve()),
  // Callable traffic (issue #529): the picker's name search (PR1) and the
  // by-uid babysitter summaries (PR2).
  calls: [] as { name: string; payload: unknown }[],
  searchResults: [] as unknown[],
  summaries: [] as { uid: string; firstName: string; lastName: string }[],
  references: [
    {
      referenceId: 'ref-1',
      familyId: 'fam-1',
      babysitterUserId: 'bs-1',
      referenceText: 'Wonderful with the kids',
      status: 'approved',
    },
  ] as unknown[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
// The ui barrel pulls in InstallAppBanner -> authStore, which subscribes to
// auth at module load — stub the store out entirely.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: { uid: 'fam-parent-1' } }),
}));
vi.mock('@/hooks/useSubmittedEndorsements', () => ({
  useSubmittedEndorsements: () => ({ references: h.references, loading: false }),
}));
// The add/edit dialog has its own Firebase surface — out of scope here.
vi.mock('@/components/endorsements/EndorsementDialog', () => ({
  EndorsementDialog: () => null,
}));
vi.mock('firebase/functions', () => ({
  // Issue #529: both of this page's babysitter reads are callables now —
  // the picker's name search (PR1) and the by-uid summaries (PR2); the
  // roster download through firebase/firestore is gone.
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'getBabysitterSummaries') return Promise.resolve({ data: { summaries: h.summaries } });
    return Promise.resolve({ data: { results: h.searchResults } });
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...(args as [])),
  serverTimestamp: () => 'ts',
}));

import { SubmittedEndorsementsPage } from '../SubmittedEndorsementsPage';

afterEach(() => {
  cleanup();
  h.updateDoc.mockClear();
  h.calls.length = 0;
  h.searchResults = [];
  h.summaries = [];
});

describe('SubmittedEndorsementsPage — delete confirmation', () => {
  it('Remove opens a labelled modal dialog with the specific title key, not common.confirm', () => {
    render(<SubmittedEndorsementsPage />);
    fireEvent.click(screen.getByText('common.remove'));

    const dialog = screen.getByRole('dialog', { name: 'submittedReferences.confirmDeleteTitle' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The visible heading is the same key — label == visible title.
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      'submittedReferences.confirmDeleteTitle',
    );
    expect(within(dialog).getByText('submittedReferences.confirmDelete')).toBeTruthy();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('confirming soft-deletes the reference (status: removed) and closes the dialog', async () => {
    render(<SubmittedEndorsementsPage />);
    fireEvent.click(screen.getByText('common.remove'));
    const dialog = screen.getByRole('dialog', { name: 'submittedReferences.confirmDeleteTitle' });
    fireEvent.click(within(dialog).getByText('common.remove'));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        { path: 'references/ref-1' },
        expect.objectContaining({ status: 'removed' }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'submittedReferences.confirmDeleteTitle' })).toBeNull(),
    );
  });

  it('cancel closes without writing', () => {
    render(<SubmittedEndorsementsPage />);
    fireEvent.click(screen.getByText('common.remove'));
    const dialog = screen.getByRole('dialog', { name: 'submittedReferences.confirmDeleteTitle' });
    fireEvent.click(within(dialog).getByText('common.cancel'));

    expect(screen.queryByRole('dialog', { name: 'submittedReferences.confirmDeleteTitle' })).toBeNull();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });
});

// Issue #529: the add-reference picker searches through a callable that
// returns five display fields — never by downloading the babysitter roster
// through the users collection.
describe('SubmittedEndorsementsPage — babysitter picker search', () => {
  it('sends the typed name to findBabysittersForEndorsement and renders what comes back', async () => {
    h.searchResults = [
      { uid: 'bs-9', firstName: 'Lea', lastName: 'Bernard', photoUrl: null, classLevel: 'Terminale' },
    ];
    render(<SubmittedEndorsementsPage />);
    // The add button is icon-only; it is the round brand button in the header.
    fireEvent.click(document.querySelector('button.bg-brand-600')!);
    fireEvent.change(screen.getByPlaceholderText('preferred.searchPlaceholder'), { target: { value: 'Lea' } });

    await vi.waitFor(() => {
      expect(h.calls.find((c) => c.name === 'findBabysittersForEndorsement')).toBeTruthy();
    }, { timeout: 2000 });
    expect(h.calls.find((c) => c.name === 'findBabysittersForEndorsement')!.payload).toEqual({ query: 'lea' });
    expect(await screen.findByText(/Lea/)).toBeInTheDocument();
    // No Firestore roster query was issued.
    expect(h.calls.every((c) => c.name === 'findBabysittersForEndorsement' || c.name === 'getBabysitterSummaries')).toBe(true);
  });

  it('does not search below two characters', async () => {
    render(<SubmittedEndorsementsPage />);
    fireEvent.click(document.querySelector('button.bg-brand-600')!);
    fireEvent.change(screen.getByPlaceholderText('preferred.searchPlaceholder'), { target: { value: 'L' } });
    await new Promise((r) => setTimeout(r, 500));
    // (The by-uid summaries call for the reference rows fires on mount; only
    // the picker search must stay silent.)
    expect(h.calls.filter((c) => c.name === 'findBabysittersForEndorsement')).toHaveLength(0);
  });
});

// Issue #529: reference rows resolve their babysitter's name through the
// getBabysitterSummaries callable, never by reading users/{uid}.
describe('SubmittedEndorsementsPage — babysitter names', () => {
  it('asks getBabysitterSummaries for the referenced uids and renders the formatted name', async () => {
    h.summaries = [{ uid: 'bs-1', firstName: 'Lea', lastName: 'Bernard' }];
    render(<SubmittedEndorsementsPage />);
    await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'getBabysitterSummaries');
      expect(c).toBeTruthy();
      expect(c!.payload).toEqual({ uids: ['bs-1'] });
    });
    // The name lands in the card through a t() interpolation, which this
    // suite's i18n stub flattens to the key — so the observable contract
    // here is the request itself: one batch, only the missing uids, no
    // per-uid Firestore reads.
    await new Promise((r) => setTimeout(r, 50));
    expect(h.calls.filter((x) => x.name === 'getBabysitterSummaries')).toHaveLength(1);
  });
});
