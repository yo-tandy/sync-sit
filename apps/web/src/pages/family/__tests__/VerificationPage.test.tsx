import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// The page drives the shared verification callables through the real
// verificationStore. Callables are dispatched by name through h.callable;
// storage is mocked because the upload paths are not what these tests pin.
const h = vi.hoisted(() => ({
  callable: vi.fn(),
  uploadBytes: vi.fn(() => Promise.resolve()),
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

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytes: (...args: unknown[]) => h.uploadBytes(...args),
  getDownloadURL: () => Promise.resolve('https://should-never-be-called'),
}));

import i18n from '@/i18n';
import { useVerificationStore } from '@/stores/verificationStore';
import { VerificationPage } from '../VerificationPage';

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
});

afterEach(() => cleanup());

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
