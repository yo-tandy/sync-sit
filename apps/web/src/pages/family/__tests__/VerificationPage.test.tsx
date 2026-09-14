import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// The page drives the shared verification callables through the real
// verificationStore, PLUS its own direct createVerificationDocumentUploadUrl
// call (issue #447) — callables are dispatched by name through h.callable;
// the signed PUT itself goes through the global `fetch`, stubbed per-test
// below (mirrors FamilySettingsPage.test.tsx's pattern for the #471
// family-photo upload).
const h = vi.hoisted(() => ({
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({
  functions: {},
  auth: {},
  db: {},
  storage: { app: { options: { storageBucket: 'sync-sit.appspot.com' } } },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    userDoc: { profiles: { parent: { familyId: 'fam1', enrollmentComplete: true } } },
    firebaseUser: { uid: 'p1' },
  }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

import i18n from '@/i18n';
import { useVerificationStore } from '@/stores/verificationStore';
import { VerificationPage } from '../VerificationPage';

const fetchMock = vi.fn();

const VERIFIED_EJM = {
  identityStatus: 'approved',
  enrollmentStatus: 'approved',
  isFullyVerified: true,
  isEjmFamily: true,
};

let statusResponse: { verification: Record<string, unknown>; documents: Record<string, unknown>[] };

function defaultCallable(name: string, payload?: unknown) {
  void payload;
  if (name === 'getVerificationStatus') return Promise.resolve({ data: statusResponse });
  if (name === 'lookupCommunityCode') {
    return Promise.resolve({ data: { familyName: 'Levi', firstName: 'Noa', lastName: 'Levi', familyId: 'fam2' } });
  }
  if (name === 'createVerificationDocumentUploadUrl') {
    return Promise.resolve({
      data: { url: 'https://signed.example.com/put', path: 'verification-documents/fam1/identity-uuid.pdf' },
    });
  }
  return Promise.resolve({ data: {} });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <VerificationPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  i18n.changeLanguage('en');
  vi.clearAllMocks();
  statusResponse = { verification: { ...VERIFIED_EJM }, documents: [] };
  h.callable.mockImplementation(defaultCallable);
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
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Issue #218 — both halves of the fix as the family actually sees them.
describe('family VerificationPage — stale community requests (#218)', () => {
  it('labels a superseded document instead of leaking the raw i18n key', async () => {
    statusResponse = {
      verification: { ...VERIFIED_EJM },
      documents: [
        {
          id: 'v3',
          type: 'ejm_enrollment',
          status: 'superseded',
          fileName: 'cert.pdf',
          childName: 'Chloe Martin',
          schoolYear: '2026-2027',
        },
      ],
    };

    renderPage();

    // The per-document badge lives on the enrollment tab.
    fireEvent.click(await screen.findByRole('button', { name: /Enrollment/ }));

    expect(await screen.findByText('Superseded')).toBeInTheDocument();
    expect(screen.queryByText(/verification\.status_/)).not.toBeInTheDocument();
  });

  it('names a stale request rather than echoing the server message', async () => {
    h.callable.mockImplementation((name: string, payload?: unknown) => {
      if (name === 'lookupCommunityCode') {
        return Promise.reject(
          Object.assign(new Error('raw server text that must not surface'), {
            details: { reason: 'already_verified' },
          }),
        );
      }
      return defaultCallable(name, payload);
    });

    renderPage();
    expect(await screen.findByText('Approve a friend')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Enter code'), { target: { value: 'zz99xx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }));

    expect(
      await screen.findByText('This request is no longer valid — this family has already been verified.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
  });

  it('still surfaces the server message for failures with no reason', async () => {
    h.callable.mockImplementation((name: string, payload?: unknown) => {
      if (name === 'lookupCommunityCode') return Promise.reject(new Error('This code has expired'));
      return defaultCallable(name, payload);
    });

    renderPage();
    expect(await screen.findByText('Approve a friend')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Enter code'), { target: { value: 'zz99xx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }));

    expect(await screen.findByText('This code has expired')).toBeInTheDocument();
  });
});

// Issue #447 — uploads go through createVerificationDocumentUploadUrl (a
// membership-checked signed-URL callable), then a PUT to the returned URL,
// exactly like FamilySettingsPage's family-photo flow (issue #471).
describe('family VerificationPage — signed-URL upload (#447)', () => {
  const NOT_SUBMITTED = {
    identityStatus: 'not_submitted',
    enrollmentStatus: 'not_submitted',
    isFullyVerified: false,
    isEjmFamily: false,
  };

  it('calls the callable with familyId/kind/contentType/fileName/sizeBytes, then PUTs with the bound headers', async () => {
    statusResponse = { verification: { ...NOT_SUBMITTED }, documents: [] };
    const { container } = renderPage();
    await screen.findAllByText('Not Submitted');

    const file = new File(['doc-bytes'], 'id.pdf', { type: 'application/pdf' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'createVerificationDocumentUploadUrl',
        {
          familyId: 'fam1',
          kind: 'identity',
          contentType: 'application/pdf',
          fileName: 'id.pdf',
          sizeBytes: file.size,
        },
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://signed.example.com/put',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/pdf',
          'x-goog-content-length-range': '0,10485760',
        },
      }),
    );
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('submitVerification', expect.anything()));
    const [, payload] = h.callable.mock.calls.find((c) => c[0] === 'submitVerification') as [
      string,
      { fileUrl: string },
    ];
    expect(payload.fileUrl).toBe(
      'https://firebasestorage.googleapis.com/v0/b/sync-sit.appspot.com/o/verification-documents%2Ffam1%2Fidentity-uuid.pdf',
    );
  });

  it('sends kind: enrollment from the enrollment tab', async () => {
    statusResponse = { verification: { ...NOT_SUBMITTED }, documents: [] };
    const { container } = renderPage();
    await screen.findAllByText('Not Submitted');

    fireEvent.click(screen.getByRole('button', { name: /Enrollment/ }));
    const file = new File(['doc-bytes'], 'cert.pdf', { type: 'application/pdf' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'createVerificationDocumentUploadUrl',
        expect.objectContaining({ kind: 'enrollment' }),
      ),
    );
  });
});

// Issue #448 — the upload catch was bare: no logging, one generic message
// for every failure. These pin that the raw error is now logged and that
// actionable codes each get their own, non-technical copy — both halves of
// this flow (the callable AND the signed PUT) can fail, and #447 replaced
// the old direct-uploadBytes failure mode with these two.
describe('family VerificationPage — upload error surfacing (#448)', () => {
  const NOT_SUBMITTED = {
    identityStatus: 'not_submitted',
    enrollmentStatus: 'not_submitted',
    isFullyVerified: false,
    isEjmFamily: false,
  };

  it('logs the raw error and shows the permission-denied copy when the callable rejects with functions/permission-denied', async () => {
    statusResponse = { verification: { ...NOT_SUBMITTED }, documents: [] };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deniedError = Object.assign(new Error('denied'), { code: 'functions/permission-denied' });
    h.callable.mockImplementation((name: string, payload?: unknown) =>
      name === 'createVerificationDocumentUploadUrl' ? Promise.reject(deniedError) : defaultCallable(name, payload),
    );

    const { container } = renderPage();
    await screen.findAllByText('Not Submitted');

    const file = new File(['doc-bytes'], 'id.pdf', { type: 'application/pdf' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(
      await screen.findByText(/don't have permission to upload for this family/),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('[verification] upload failed', deniedError);
    consoleError.mockRestore();
  });

  it('shows the connection-problem copy when the signed PUT itself fails', async () => {
    statusResponse = { verification: { ...NOT_SUBMITTED }, documents: [] };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);

    const { container } = renderPage();
    await screen.findAllByText('Not Submitted');

    const file = new File(['doc-bytes'], 'id.pdf', { type: 'application/pdf' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText('There was a connection problem. Please try again.')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('[verification] upload failed', expect.objectContaining({ code: 'upload/network' }));
    consoleError.mockRestore();
  });

  it('falls back to the generic copy when the rejection carries no code', async () => {
    statusResponse = { verification: { ...NOT_SUBMITTED }, documents: [] };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.callable.mockImplementation((name: string, payload?: unknown) =>
      name === 'submitVerification' ? Promise.reject(new Error('boom')) : defaultCallable(name, payload),
    );

    const { container } = renderPage();
    await screen.findAllByText('Not Submitted');

    const file = new File(['doc-bytes'], 'id.pdf', { type: 'application/pdf' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText(/An error occurred while uploading/)).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('[verification] upload failed', expect.any(Error));
    consoleError.mockRestore();
  });
});
