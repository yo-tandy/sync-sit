import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The dashboard reads the auth store for the
// tutor profile (state-contract source) and the schedules doc for the
// availability gate; both are driven through `h`.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 't1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  // What getDoc(schedules/uid) resolves to. null => doc absent (no slots).
  scheduleData: null as { weekly?: Record<string, boolean[]> } | null,
  // studyContactRequests docs for the pending-count card.
  requests: [] as Record<string, unknown>[],
  updateDoc: vi.fn(() => Promise.resolve()),
  getDoc: vi.fn(),
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  getDocs: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { DashboardPage } from '../DashboardPage';

function tutor(overrides: Record<string, unknown> = {}) {
  return { uid: 't1', profiles: { tutor: { enrollmentComplete: false, subjects: [], ...overrides } } };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.auth.userDoc = null;
  h.auth.refreshUserDoc.mockClear();
  h.scheduleData = null;
  h.requests = [];
  h.updateDoc.mockClear();
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.scheduleData != null, data: () => h.scheduleData })
  );
  h.where.mockClear();
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.requests.map((r) => ({ id: r.requestId, data: () => r })) }),
  );
}

describe('tutor DashboardPage', () => {
  beforeEach(() => reset());

  // ── State-contract rows (one render assertion each) ──

  it('not_submitted (verification absent): shows the upload-your-ID banner', () => {
    h.auth.userDoc = tutor(); // no verification field => not_submitted
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/upload your id/i)).toBeInTheDocument();
  });

  it('pending / not live: shows the under-review banner', () => {
    h.auth.userDoc = tutor({ enrollmentComplete: false, verification: { identityStatus: 'pending' } });
    renderWithProviders(<DashboardPage />);
    // Body copy unique to this row — /under review/ alone would also match the
    // pending/live row's "New document under review" banner.
    expect(screen.getByText(/your id is being reviewed/i)).toBeInTheDocument();
    expect(screen.queryByText(/new document under review/i)).not.toBeInTheDocument();
  });

  it('approved / live: shows the verified banner', () => {
    h.auth.userDoc = tutor({
      enrollmentComplete: true,
      verification: { identityStatus: 'approved' },
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/you're verified|you are verified/i)).toBeInTheDocument();
  });

  it('rejected: shows a rejection banner with a resubmit CTA to verification', () => {
    h.auth.userDoc = tutor({ enrollmentComplete: false, verification: { identityStatus: 'rejected' } });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/verification unsuccessful/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /resubmit|review/i });
    expect(cta).toHaveAttribute('href', '/tutor/verification');
  });

  it('pending / live: shows the "new document under review, still live" banner', () => {
    h.auth.userDoc = tutor({
      enrollmentComplete: true,
      verification: { identityStatus: 'pending' },
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/new document under review/i)).toBeInTheDocument();
    expect(screen.getByText(/still|stay|listed|live/i)).toBeInTheDocument();
  });

  // ── Activation toggle gating ──

  it('approved but no subjects: toggle disabled with explanatory text', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      enrollmentComplete: true,
      verification: { identityStatus: 'approved' },
      subjects: [],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const toggle = await screen.findByRole('button', { name: /show me in search/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/add at least one subject/i)).toBeInTheDocument();
  });

  it('approved with subjects + schedule slots: toggle enabled, writes searchable=true', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      enrollmentComplete: true,
      verification: { identityStatus: 'approved' },
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const toggle = await screen.findByRole('button', { name: /show me in search/i });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ 'profiles.tutor.searchable': true })
      )
    );
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('approved but no schedule slots: toggle disabled with availability text', async () => {
    h.scheduleData = null; // no schedule doc => no slots
    h.auth.userDoc = tutor({
      enrollmentComplete: true,
      verification: { identityStatus: 'approved' },
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const toggle = await screen.findByRole('button', { name: /show me in search/i });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(screen.getByText(/set your weekly availability/i)).toBeInTheDocument();
  });

  // ── Current searchable-state rendering ──

  it('approved + searchable: renders the live state', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      enrollmentComplete: true,
      verification: { identityStatus: 'approved' },
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: true,
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/families can find you/i)).toBeInTheDocument();
    // Live tutors get the hide action.
    expect(screen.getByRole('button', { name: /hide me from search/i })).toBeInTheDocument();
  });

  it('approved + not searchable: renders the hidden state', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      enrollmentComplete: true,
      verification: { identityStatus: 'approved' },
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/not shown in search/i)).toBeInTheDocument();
  });

  // ── Sessions empty state + entry cards ──

  it('renders the upcoming-sessions empty state and entry cards', () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true, verification: { identityStatus: 'approved' }, subjects: [] });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /subjects/i })).toHaveAttribute('href', '/tutor/subjects');
    expect(screen.getByRole('link', { name: /availability|schedule/i })).toHaveAttribute('href', '/tutor/schedule');
    expect(screen.getByRole('link', { name: /account/i })).toHaveAttribute('href', '/tutor/account');
  });

  // ── Pending-requests card ──

  it('renders a pending-requests card with the count, linking to /tutor/requests', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true, verification: { identityStatus: 'approved' } });
    h.requests = [
      { requestId: 'r1', tutorUserId: 't1', status: 'pending' },
      { requestId: 'r2', tutorUserId: 't1', status: 'pending' },
      { requestId: 'r3', tutorUserId: 't1', status: 'accepted' },
    ];
    renderWithProviders(<DashboardPage />);

    const link = await screen.findByRole('link', { name: /requests/i });
    expect(link).toHaveAttribute('href', '/tutor/requests');
    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    expect(await screen.findByText('2')).toBeInTheDocument();
  });
});
