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
