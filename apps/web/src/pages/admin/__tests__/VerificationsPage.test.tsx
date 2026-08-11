import { describe, it, expect, vi, beforeEach } from 'vitest';

// Avoid initializing the real Firebase app in jsdom.
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

// Controllable verification store state.
const storeState: {
  pendingVerifications: Record<string, unknown>[];
  pendingLoading: boolean;
  fetchPendingVerifications: ReturnType<typeof vi.fn>;
  reviewVerification: ReturnType<typeof vi.fn>;
} = {
  pendingVerifications: [],
  pendingLoading: false,
  fetchPendingVerifications: vi.fn(),
  reviewVerification: vi.fn(),
};
vi.mock('@/stores/verificationStore', () => ({
  useVerificationStore: () => storeState,
}));

import i18n from '@/i18n';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AdminVerificationsPage } from '../VerificationsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminVerificationsPage />
    </MemoryRouter>,
  );
}

describe('AdminVerificationsPage tutor identity review', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    storeState.pendingVerifications = [];
    storeState.pendingLoading = false;
    storeState.fetchPendingVerifications = vi.fn();
    storeState.reviewVerification = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a tutor identity doc with tutorName + Tutor ID badge and no family fields', () => {
    storeState.pendingVerifications = [
      {
        id: 't1',
        type: 'tutor_identity',
        status: 'pending',
        tutorName: 'Alice Tutor',
        fileUrl: 'https://storage.googleapis.com/b/o/verification-documents%2Fx.pdf?alt=media',
        fileName: 'x.pdf',
        createdAt: '2026-07-01T00:00:00Z',
      },
    ];
    renderPage();

    expect(screen.getByText('Alice Tutor')).toBeInTheDocument();
    // Tutor ID type badge (a <span>) is present, distinct from the filter <option>.
    const tutorIdMatches = screen.getAllByText(i18n.t('verification.typeTutorIdentity'));
    expect(tutorIdMatches.some((el) => el.tagName === 'SPAN')).toBe(true);
    // Family-only pieces are absent for a tutor doc.
    expect(screen.queryByText(i18n.t('verification.unknownFamily'))).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t('verification.registeredFamily'))).not.toBeInTheDocument();
  });

  it('renders a family enrollment doc with family fields (regression)', () => {
    storeState.pendingVerifications = [
      {
        id: 'f1',
        type: 'ejm_enrollment',
        status: 'pending',
        familyName: 'The Smiths',
        parentName: 'Bob Smith',
        familyParentNames: ['Bob Smith'],
        familyKids: [{ firstName: 'Kid', age: 5 }],
        fileUrl: 'https://storage.googleapis.com/b/o/verification-documents%2Ff.pdf?alt=media',
        fileName: 'f.pdf',
        createdAt: '2026-07-01T00:00:00Z',
      },
    ];
    renderPage();

    expect(screen.getByText('The Smiths')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('verification.registeredFamily'))).toBeInTheDocument();
  });

  it('offers a tutor identity option in the type filter', () => {
    renderPage();
    const option = screen.getByRole('option', { name: i18n.t('verification.typeTutorIdentity') });
    expect(option).toBeInTheDocument();
  });
});

describe('AdminVerificationsPage view-document error surfacing', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    storeState.pendingVerifications = [
      {
        id: 'v1',
        type: 'identity',
        status: 'pending',
        familyName: 'Dupont',
        fileUrl:
          'https://firebasestorage.googleapis.com/v0/b/sync-sit.appspot.com/o/verification-documents%2Ffam1%2Fid.pdf',
        fileName: 'id.pdf',
        createdAt: '2026-07-01T00:00:00Z',
      },
    ];
    storeState.pendingLoading = false;
    storeState.fetchPendingVerifications = vi.fn();
    storeState.reviewVerification = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('surfaces an inline error and never falls back to the raw fileUrl when the callable fails', async () => {
    const { httpsCallable } = await import('firebase/functions');
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(
      vi.fn().mockRejectedValue(new Error('internal')),
    );
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        i18n.t('verification.viewDocumentError'),
      ),
    );
    // The old masking fallback (window.open(raw fileUrl)) must be gone.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens the signed URL (not the raw fileUrl) on success and shows no error', async () => {
    const { httpsCallable } = await import('firebase/functions');
    const fn = vi.fn().mockResolvedValue({ data: { url: 'https://signed.example/u' } });
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(fn);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://signed.example/u', '_blank'));
    expect(fn).toHaveBeenCalledWith({ filePath: 'verification-documents/fam1/id.pdf' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces an error for an unparseable fileUrl instead of opening it raw', async () => {
    storeState.pendingVerifications[0].fileUrl = 'https://example.com/no-object-segment';
    const { httpsCallable } = await import('firebase/functions');
    const fn = vi.fn();
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(fn);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(fn).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('treats a popup-blocked open (null return) as a surfaced error', async () => {
    const { httpsCallable } = await import('firebase/functions');
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(
      vi.fn().mockResolvedValue({ data: { url: 'https://signed.example/u' } }),
    );
    vi.spyOn(window, 'open').mockReturnValue(null);

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
