import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// The page drives the SHARED verification callables through the real
// verificationStore (getVerificationStatus / submitVerification /
// generateCommunityCode / lookupCommunityCode / approveCommunityCode) and
// uploads to the shared bucket via firebase/storage. Callables are dispatched
// by name through h.callable; storage is fully mocked. getDownloadURL is
// mocked ONLY to pin its absence: calling it after an upload always failed
// (storage.rules denies reads on verification-documents/**) — that regression
// was fixed in sit (8f7802c) and must not be re-ported here.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: {
      profiles: { parent: { familyId: 'fam1', enrollmentComplete: true } },
    } as Record<string, unknown> | null,
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
  },
  // (name, payload) => Promise<{ data }>. Reassigned/inspected per test.
  callable: vi.fn(),
  uploadBytes: vi.fn<(ref: { path: string }, data: File) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  getDownloadURL: vi.fn<(ref: { path: string }) => Promise<string>>(() =>
    Promise.resolve('https://should-never-be-called'),
  ),
}));

vi.mock('@/config/firebase', () => ({
  db: {},
  functions: {},
  storage: { app: { options: { storageBucket: 'sync-sit.appspot.com' } } },
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytes: (...args: [ref: { path: string }, data: File]) => h.uploadBytes(...args),
  getDownloadURL: (...args: [ref: { path: string }]) => h.getDownloadURL(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { VerificationPage } from '../VerificationPage';
import { useVerificationStore } from '@/stores/verificationStore';

type Verification = {
  identityStatus: string;
  enrollmentStatus: string;
  isFullyVerified: boolean;
  isEjmFamily: boolean;
};

const NOT_SUBMITTED: Verification = {
  identityStatus: 'not_submitted',
  enrollmentStatus: 'not_submitted',
  isFullyVerified: false,
  isEjmFamily: false,
};

// Default callable dispatch: status is test-seeded; the rest resolve happily.
let statusResponse: { verification: Verification; documents: Record<string, unknown>[] };

function defaultCallable(name: string, payload: unknown) {
  void payload;
  switch (name) {
    case 'getVerificationStatus':
      return Promise.resolve({ data: statusResponse });
    case 'generateCommunityCode':
      return Promise.resolve({ data: { code: 'ABC123', expiresAt: new Date(Date.now() + 3600_000).toISOString() } });
    case 'lookupCommunityCode':
      return Promise.resolve({ data: { familyName: 'Levi', firstName: 'Noa', lastName: 'Levi', familyId: 'fam2' } });
    default:
      return Promise.resolve({ data: {} });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  statusResponse = { verification: { ...NOT_SUBMITTED }, documents: [] };
  h.callable.mockImplementation(defaultCallable);
  h.auth.userDoc = { profiles: { parent: { familyId: 'fam1', enrollmentComplete: true } } };
  // The store is module-level zustand state — reset the data slice between tests.
  useVerificationStore.setState({
    familyVerification: null,
    documents: [],
    loading: false,
    uploading: false,
    communityCode: null,
    communityCodeExpires: null,
    communityCodeLoading: false,
    lookupResult: null,
    lookupLoading: false,
    approving: false,
  });
});

describe('family VerificationPage', () => {
  it('fetches status via the shared getVerificationStatus callable on mount', async () => {
    renderWithProviders(<VerificationPage />);
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('getVerificationStatus', {}));
    // Both rows plus tab badges absent while not_submitted: exactly the two overview badges.
    expect(await screen.findAllByText('Not Submitted')).toHaveLength(2);
    expect(screen.getByText(/Sync\/Study connects EJM families/)).toBeInTheDocument();
  });

  it('renders the pending state for a submitted identity document', async () => {
    statusResponse = {
      verification: { ...NOT_SUBMITTED, identityStatus: 'pending' },
      documents: [{ id: 'v1', type: 'identity', status: 'pending', fileName: 'passport.pdf' }],
    };
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('passport.pdf')).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    // Overview badge + tab badge + card badge all say Pending Review.
    expect(screen.getAllByText('Pending Review').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the rejected state with the admin rejection reason', async () => {
    statusResponse = {
      verification: { ...NOT_SUBMITTED, identityStatus: 'rejected' },
      documents: [{ id: 'v1', type: 'identity', status: 'rejected', fileName: 'passport.pdf', rejectionReason: 'Document unreadable' }],
    };
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Document unreadable')).toBeInTheDocument();
    expect(screen.getByText('Rejection reason:')).toBeInTheDocument();
    // The upload form is offered again after a rejection.
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('renders the fully-verified state: green banner, no explainer, no ask-for-code card', async () => {
    statusResponse = {
      verification: { identityStatus: 'approved', enrollmentStatus: 'approved', isFullyVerified: true, isEjmFamily: true },
      documents: [{ id: 'v1', type: 'identity', status: 'approved', fileName: 'passport.pdf' }],
    };
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Verification Complete')).toBeInTheDocument();
    expect(screen.queryByText(/Sync\/Study connects EJM families/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ask for a verification')).not.toBeInTheDocument();
    // Verified EJM family gets the approve-a-friend card instead.
    expect(screen.getByText('Approve a friend')).toBeInTheDocument();
  });

  it('uploads to verification-documents/{familyId}/ and submits the constructed fileUrl WITHOUT getDownloadURL', async () => {
    renderWithProviders(<VerificationPage />);
    await screen.findAllByText('Not Submitted');

    const file = new File(['doc-bytes'], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Identity'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalledTimes(1));
    const [storageRef, uploaded] = h.uploadBytes.mock.calls[0];
    expect(storageRef.path).toMatch(/^verification-documents\/fam1\/\d+-id\.pdf$/);
    expect(uploaded).toBe(file);

    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('submitVerification', expect.anything()));
    const [, payload] = h.callable.mock.calls.find((c) => c[0] === 'submitVerification') as [
      string,
      { type: string; fileUrl: string; fileName: string },
    ];
    expect(payload.type).toBe('identity');
    expect(payload.fileName).toBe('id.pdf');
    // The stored URL is CONSTRUCTED (parseable by the admin UI on '/o/'),
    // never fetched: storage.rules denies reads on verification-documents/**,
    // so a getDownloadURL round-trip always failed (regression pinned here).
    expect(payload.fileUrl).toBe(
      `https://firebasestorage.googleapis.com/v0/b/sync-sit.appspot.com/o/${encodeURIComponent(storageRef.path)}`,
    );
    expect(h.getDownloadURL).not.toHaveBeenCalled();

    // Status is re-fetched after the submit.
    await waitFor(() =>
      expect(h.callable.mock.calls.filter((c) => c[0] === 'getVerificationStatus').length).toBeGreaterThanOrEqual(2),
    );
  });

  it('submits an enrollment document as type ejm_enrollment from the enrollment tab', async () => {
    renderWithProviders(<VerificationPage />);
    await screen.findAllByText('Not Submitted');

    fireEvent.click(screen.getByRole('button', { name: /EJM Enrollment/ }));
    const file = new File(['doc-bytes'], 'certificat.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('EJM Enrollment'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('submitVerification', expect.anything()));
    const [, payload] = h.callable.mock.calls.find((c) => c[0] === 'submitVerification') as [
      string,
      { type: string; fileName: string },
    ];
    expect(payload.type).toBe('ejm_enrollment');
    expect(payload.fileName).toBe('certificat.pdf');
    expect(h.getDownloadURL).not.toHaveBeenCalled();
  });

  it('rejects an oversized file client-side without touching storage', async () => {
    renderWithProviders(<VerificationPage />);
    await screen.findAllByText('Not Submitted');

    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Identity'), { target: { files: [big] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText(/File is too large/)).toBeInTheDocument();
    expect(h.uploadBytes).not.toHaveBeenCalled();
    expect(h.callable).not.toHaveBeenCalledWith('submitVerification', expect.anything());
  });

  it('surfaces the upload error and keeps the form usable when the submit fails', async () => {
    h.callable.mockImplementation((name: string, payload: unknown) =>
      name === 'submitVerification'
        ? Promise.reject(new Error('boom'))
        : defaultCallable(name, payload),
    );
    renderWithProviders(<VerificationPage />);
    await screen.findAllByText('Not Submitted');

    const file = new File(['doc-bytes'], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Identity'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText(/An error occurred while uploading/)).toBeInTheDocument();
  });

  it('generates and displays a community code with its expiry (unverified family)', async () => {
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Ask for a verification')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Code' }));
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('generateCommunityCode', {}));
    expect(await screen.findByText('ABC123')).toBeInTheDocument();
    expect(screen.getByText(/Expires:/)).toBeInTheDocument();
    // An unverified family can ask to be vouched for but never vouch for others.
    expect(screen.queryByText('Approve a friend')).not.toBeInTheDocument();
  });

  it('approve-a-friend: looks up the code, gates approval on both checkboxes, then approves', async () => {
    statusResponse = {
      verification: { identityStatus: 'approved', enrollmentStatus: 'approved', isFullyVerified: true, isEjmFamily: true },
      documents: [],
    };
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Approve a friend')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Enter code'), { target: { value: 'zz99xx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }));
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('lookupCommunityCode', { code: 'ZZ99XX' }));

    // Confirmation copy names the person and family (family name uppercased).
    expect(await screen.findByText(/Noa LEVI/)).toBeInTheDocument();
    expect(screen.getByText(/LEVI family/)).toBeInTheDocument();

    const approveButton = screen.getByRole('button', { name: 'Approve' });
    expect(approveButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I know this person/));
    expect(approveButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I confirm that they have kids/));
    expect(approveButton).toBeEnabled();

    fireEvent.click(approveButton);
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('approveCommunityCode', { code: 'ZZ99XX' }));
    expect(await screen.findByText('Account approved successfully!')).toBeInTheDocument();
  });

  it('hides approve-a-friend from a fully verified NON-EJM family (community-verified)', async () => {
    statusResponse = {
      verification: { identityStatus: 'approved', enrollmentStatus: 'approved', isFullyVerified: true, isEjmFamily: false },
      documents: [],
    };
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Verification Complete')).toBeInTheDocument();
    expect(screen.queryByText('Approve a friend')).not.toBeInTheDocument();
  });

  it('lists submitted enrollment documents with child metadata and per-doc status', async () => {
    statusResponse = {
      verification: { ...NOT_SUBMITTED, enrollmentStatus: 'approved' },
      documents: [
        { id: 'v2', type: 'ejm_enrollment', status: 'approved', fileName: 'cert.pdf', childName: 'Maya Cohen', schoolYear: '2026-2027', classLevel: 'CE2' },
      ],
    };
    renderWithProviders(<VerificationPage />);
    await screen.findAllByText(/Approved/);

    fireEvent.click(screen.getByRole('button', { name: /EJM Enrollment/ }));
    expect(await screen.findByText('Maya Cohen')).toBeInTheDocument();
    expect(screen.getByText(/2026-2027/)).toBeInTheDocument();
    expect(screen.getByText(/CE2/)).toBeInTheDocument();
  });

  // Issue #218 — a community approval supersedes the family's pending docs,
  // and getVerificationStatus hands every doc back unfiltered, so this status
  // reaches BOTH family apps. Without a locale key the badge renders the raw
  // i18n path.
  it('labels a superseded document instead of leaking the raw i18n key', async () => {
    statusResponse = {
      verification: { identityStatus: 'approved', enrollmentStatus: 'approved', isFullyVerified: true, isEjmFamily: true },
      documents: [
        { id: 'v3', type: 'ejm_enrollment', status: 'superseded', fileName: 'cert.pdf', childName: 'Chloe Martin' },
      ],
    };
    renderWithProviders(<VerificationPage />);

    // The per-document badge lives on the enrollment tab.
    fireEvent.click(await screen.findByRole('button', { name: /EJM Enrollment/ }));

    expect(await screen.findByText('Superseded')).toBeInTheDocument();
    expect(screen.queryByText(/family\.verification\.status_/)).not.toBeInTheDocument();
  });

  it('names a stale community request rather than echoing the server message', async () => {
    statusResponse = {
      verification: { identityStatus: 'approved', enrollmentStatus: 'approved', isFullyVerified: true, isEjmFamily: true },
      documents: [],
    };
    h.callable.mockImplementation((name: string, payload: unknown) => {
      if (name === 'lookupCommunityCode') {
        return Promise.reject(
          Object.assign(new Error('raw server text that must not surface'), {
            details: { reason: 'already_verified' },
          }),
        );
      }
      return defaultCallable(name, payload);
    });

    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Approve a friend')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Enter code'), { target: { value: 'zz99xx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }));

    expect(
      await screen.findByText('This request is no longer valid — this family has already been verified.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
  });
});
