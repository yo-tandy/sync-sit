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
