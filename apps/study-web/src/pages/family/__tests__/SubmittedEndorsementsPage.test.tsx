import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// The page runs two live equality queries: this family's study endorsements
// (references where submittedByFamilyId==mine && appSource=='study') and the
// family's own contact requests (the only family-readable source of tutor
// display names). Snapshots are test-driven per collection path.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: {
      profiles: { parent: { familyId: 'fam1', enrollmentComplete: true } },
    } as Record<string, unknown> | null,
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
  },
  endorsementDocs: [] as Record<string, unknown>[],
  requestDocs: [] as Record<string, unknown>[],
  wheres: [] as [string, string, unknown][],
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
  unsubscribe: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (coll: { path: string }, ...clauses: unknown[]) => ({ coll, clauses }),
  where: (...args: [string, string, unknown]) => {
    h.wheres.push(args);
    return { where: args };
  },
  onSnapshot: (
    q: { coll: { path: string } },
    onNext: (snap: { docs: { data: () => Record<string, unknown> }[] }) => void,
  ) => {
    const rows = q.coll.path === 'references' ? h.endorsementDocs : h.requestDocs;
    onNext({ docs: rows.map((d) => ({ data: () => d })) });
    return h.unsubscribe;
  },
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => 'SERVER_TS',
  deleteField: () => 'DELETE_FIELD',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { SubmittedEndorsementsPage } from '../SubmittedEndorsementsPage';

const ts = (seconds: number) => ({ seconds, nanoseconds: 0 });

function endorsement(overrides: Record<string, unknown> = {}) {
  return {
    referenceId: 'e1',
    tutorUserId: 't1',
    appSource: 'study',
    type: 'family_submitted',
    status: 'private',
    submittedByUserId: 'p1',
    submittedByFamilyId: 'fam1',
    refName: 'Dana W.',
    referenceText: 'Wonderful with our daughter, patient and structured.',
    createdAt: ts(1_700_000_000),
    updatedAt: ts(1_700_000_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.wheres.length = 0;
  h.endorsementDocs = [];
  h.requestDocs = [
    { requestId: 'r1', tutorUserId: 't1', familyId: 'fam1', tutorName: 'Alex Roy', status: 'accepted' },
  ];
  h.auth.userDoc = { profiles: { parent: { familyId: 'fam1', enrollmentComplete: true } } };
  h.auth.firebaseUser = { uid: 'p1' };
});

describe('family SubmittedEndorsementsPage', () => {
  it('subscribes with the provable family+app equality clauses', () => {
    renderWithProviders(<SubmittedEndorsementsPage />);
    expect(h.wheres).toContainEqual(['submittedByFamilyId', '==', 'fam1']);
    expect(h.wheres).toContainEqual(['appSource', '==', 'study']);
    expect(h.wheres).toContainEqual(['familyId', '==', 'fam1']);
  });

  it('renders an endorsement with the tutor name resolved from the request docs', () => {
    h.endorsementDocs = [endorsement()];
    renderWithProviders(<SubmittedEndorsementsPage />);
    expect(screen.getByText('Alex Roy')).toBeInTheDocument();
    expect(screen.getByText(/Wonderful with our daughter/)).toBeInTheDocument();
    expect(screen.getByText('Pending with tutor')).toBeInTheDocument();
  });

  it('offers edit and withdraw ONLY while the endorsement is private', () => {
    h.endorsementDocs = [
      endorsement(),
      endorsement({ referenceId: 'e2', status: 'published', referenceText: 'Published text here.' }),
    ];
    renderWithProviders(<SubmittedEndorsementsPage />);
    // One private row: exactly one Edit and one Withdraw.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('saves an edit with only the content keys (identity tuple untouched)', async () => {
    h.endorsementDocs = [endorsement()];
    renderWithProviders(<SubmittedEndorsementsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByLabelText('Endorsement') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Updated endorsement text body.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const [ref, payload] = h.updateDoc.mock.calls[0];
    expect(ref.path).toBe('references/e1');
    expect(Object.keys(payload).sort()).toEqual(['refName', 'referenceText', 'updatedAt']);
    expect(payload.referenceText).toBe('Updated endorsement text body.');
  });

  it('withdraws via a confirm dialog with a status-only transition to removed', async () => {
    h.endorsementDocs = [endorsement()];
    renderWithProviders(<SubmittedEndorsementsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(screen.getByText(/will be withdrawn/)).toBeInTheDocument();
    // The dialog's confirm button carries the same label; take the last one.
    const buttons = screen.getAllByRole('button', { name: 'Withdraw' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const [ref, payload] = h.updateDoc.mock.calls[0];
    expect(ref.path).toBe('references/e1');
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('removed');
  });

  it('sorts newest-first client-side (equality-only query, no composite index)', () => {
    h.endorsementDocs = [
      endorsement({ referenceId: 'old', referenceText: 'Older endorsement text.', createdAt: ts(1_600_000_000) }),
      endorsement({ referenceId: 'new', referenceText: 'Newer endorsement text.', createdAt: ts(1_700_000_000) }),
    ];
    renderWithProviders(<SubmittedEndorsementsPage />);
    const newer = screen.getByText(/Newer endorsement/);
    const older = screen.getByText(/Older endorsement/);
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps withdrawn endorsements visible with the removed chip and no actions (no dead end)', () => {
    // The submit callable de-dupes per (tutor, family) regardless of status,
    // so a withdrawn endorsement cannot be re-submitted — it must stay
    // visible or the family is left with an invisible, unrecoverable state.
    h.endorsementDocs = [endorsement({ status: 'removed' })];
    renderWithProviders(<SubmittedEndorsementsPage />);
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(screen.queryByText('No endorsements yet')).toBeNull();
  });

  it('shows the empty state (not a spinner) when there are no endorsements at all', () => {
    renderWithProviders(<SubmittedEndorsementsPage />);
    expect(screen.getByText('No endorsements yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your requests' })).toHaveAttribute(
      'href',
      '/family/requests',
    );
  });

  it('shows the empty state, never an infinite spinner, for a parent with no familyId', () => {
    h.auth.userDoc = { profiles: { parent: { enrollmentComplete: false } } };
    renderWithProviders(<SubmittedEndorsementsPage />);
    expect(screen.getByText('No endorsements yet')).toBeInTheDocument();
  });

  it('offers no actions on a co-parent\'s private endorsement (rules require the submitter)', () => {
    h.endorsementDocs = [endorsement({ submittedByUserId: 'other-parent' })];
    renderWithProviders(<SubmittedEndorsementsPage />);
    expect(screen.getByText(/Wonderful with our daughter/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });
});
