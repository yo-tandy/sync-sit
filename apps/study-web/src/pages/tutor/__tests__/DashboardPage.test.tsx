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
  // study-sessions docs for the pending-sessions count card.
  sessions: [] as Record<string, unknown>[],
  // references docs (endorsements) for the pending-endorsements count card.
  refs: [] as Record<string, unknown>[],
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

// Current-model default: enrollTutor writes enrollmentComplete: true at
// creation (owner decision 2026-08-17, no identity verification). Legacy docs
// override it to false explicitly.
function tutor(overrides: Record<string, unknown> = {}) {
  return { uid: 't1', profiles: { tutor: { enrollmentComplete: true, subjects: [], ...overrides } } };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.auth.userDoc = null;
  h.auth.refreshUserDoc.mockClear();
  h.scheduleData = null;
  h.requests = [];
  h.sessions = [];
  h.refs = [];
  h.updateDoc.mockClear();
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.scheduleData != null, data: () => h.scheduleData })
  );
  h.where.mockClear();
  h.getDocs.mockReset();
  // Route by collection path: references => endorsements, study-sessions =>
  // sessions, else => contact requests. (All count cards read by
  // tutorUserId==me.)
  h.getDocs.mockImplementation((q: { query: { path: string }[] }) => {
    const path = q?.query?.[0]?.path;
    const rows = path === 'references' ? h.refs : path === 'study-sessions' ? h.sessions : h.requests;
    return Promise.resolve({
      docs: rows.map((r) => ({ id: r.referenceId ?? r.sessionId ?? r.requestId, data: () => r })),
    });
  });
}

describe('tutor DashboardPage', () => {
  beforeEach(() => reset());

  // ── No verification surface (feature dropped, owner decision 2026-08-17) ──

  it('renders no verification banner, tile, or link anywhere', async () => {
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.queryByText(/verif/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upload your id/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/tutor/verification"]')).toBeNull();
  });

  it('legacy doc (enrollmentComplete=false): no activation card renders', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      enrollmentComplete: false,
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.queryByText(/search visibility/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show me in search/i })).not.toBeInTheDocument();
  });

  // ── Activation toggle gating (subjects + availability only) ──

  it('no subjects: toggle disabled with explanatory text', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      subjects: [],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const toggle = await screen.findByRole('button', { name: /show me in search/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/add at least one subject/i)).toBeInTheDocument();
  });

  it('subjects + schedule slots: toggle enabled, writes searchable=true', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
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

  it('no schedule slots: toggle disabled with availability text', async () => {
    h.scheduleData = null; // no schedule doc => no slots
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const toggle = await screen.findByRole('button', { name: /show me in search/i });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(screen.getByText(/set your weekly availability/i)).toBeInTheDocument();
  });

  // ── Current searchable-state rendering ──

  it('searchable: renders the live state', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: true,
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/families can find you/i)).toBeInTheDocument();
    // Live tutors get the hide action.
    expect(screen.getByRole('button', { name: /hide me from search/i })).toBeInTheDocument();
  });

  it('not searchable: renders the hidden state', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/not shown in search/i)).toBeInTheDocument();
  });

  // ── Sessions empty state + entry cards ──

  it('renders the upcoming-sessions empty state and entry cards', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true, subjects: [] });
    renderWithProviders(<DashboardPage />);
    // findBy, not getBy: the empty line renders only AFTER the sessions
    // snapshot resolves — a synchronous match would be pinning the
    // empty-state flash this page deliberately avoids.
    expect(await screen.findByText(/no sessions yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /subjects/i })).toHaveAttribute('href', '/tutor/subjects');
    expect(screen.getByRole('link', { name: /availability|schedule/i })).toHaveAttribute('href', '/tutor/schedule');
    expect(screen.getByRole('link', { name: /account/i })).toHaveAttribute('href', '/tutor/account');
  });

  it('no hero renders while the requests snapshot is still in flight', async () => {
    // The two queries resolve independently; ranking on a still-null request
    // count would let the sessions hero paint and then visibly swap to the
    // requests hero. The ladder must wait for BOTH snapshots.
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    h.sessions = [{ sessionId: 's1', tutorUserId: 't1', status: 'pending' }];
    const defaultImpl = h.getDocs.getMockImplementation()!;
    h.getDocs.mockImplementation((q: { query?: { path: string }[] }) => {
      const path = q?.query?.[0]?.path ?? '';
      if (path === 'studyContactRequests') return new Promise(() => {});
      return defaultImpl(q);
    });
    renderWithProviders(<DashboardPage />);

    // Settle on the sessions tile's badge (its snapshot resolved)...
    expect(await screen.findByText('1')).toBeInTheDocument();
    // ...but no hero: the pending-sessions title must not paint early.
    expect(screen.queryByText(/awaiting confirmation/i)).not.toBeInTheDocument();
  });

  it('a recurring-only tutor sees NO "no sessions yet" on the sessions tile', async () => {
    // `next` excludes recurring series on purpose (instances live in a
    // subcollection this page must not query) — but the tile's empty line is
    // keyed on ALL non-terminal sessions, so an active series is not "none".
    h.auth.userDoc = tutor({ enrollmentComplete: true, subjects: [] });
    h.sessions = [
      { sessionId: 's1', tutorUserId: 't1', status: 'confirmed', type: 'recurring', date: '2099-01-01' },
    ];
    renderWithProviders(<DashboardPage />);

    // Settle on something that renders after the snapshots resolve.
    await screen.findByRole('link', { name: /^contact requests$/i });
    expect(screen.queryByText(/no sessions yet/i)).not.toBeInTheDocument();
    // And the series still does not claim the hero.
    expect(screen.queryByText(/next session/i)).not.toBeInTheDocument();
  });

  // ── Pending-requests card ──

  it('renders a pending-requests card with the count, linking to /tutor/requests', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    h.requests = [
      { requestId: 'r1', tutorUserId: 't1', status: 'pending' },
      { requestId: 'r2', tutorUserId: 't1', status: 'pending' },
      { requestId: 'r3', tutorUserId: 't1', status: 'accepted' },
    ];
    renderWithProviders(<DashboardPage />);

    // Anchored: the pending-requests HERO's label also contains "requests".
    const link = await screen.findByRole('link', { name: /^contact requests$/i });
    expect(link).toHaveAttribute('href', '/tutor/requests');
    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  // ── Pending-sessions card ──

  it('renders a pending-sessions card with the count, linking to /tutor/sessions', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    h.sessions = [
      { sessionId: 's1', tutorUserId: 't1', status: 'pending' },
      { sessionId: 's2', tutorUserId: 't1', status: 'pending' },
      { sessionId: 's3', tutorUserId: 't1', status: 'confirmed' },
    ];
    renderWithProviders(<DashboardPage />);

    const link = await screen.findByRole('link', { name: /^sessions$/i });
    expect(link).toHaveAttribute('href', '/tutor/sessions');
    // Only the two pending ones count.
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  // ── Pending-endorsements card ──

  it('renders a pending-endorsements card counting private refs, linking to /tutor/endorsements', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    h.refs = [
      { referenceId: 'e1', tutorUserId: 't1', status: 'private' },
      { referenceId: 'e2', tutorUserId: 't1', status: 'private' },
      { referenceId: 'e3', tutorUserId: 't1', status: 'approved' },
      { referenceId: 'e4', tutorUserId: 't1', status: 'removed' },
    ];
    renderWithProviders(<DashboardPage />);

    const link = await screen.findByRole('link', { name: /endorsements/i });
    expect(link).toHaveAttribute('href', '/tutor/endorsements');
    // Only the two private ones count as pending.
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  // ── Supervision request card (guardianLinks/{ownUid} pending claim) ──

  it('shows the supervision request card when a pending claim exists', async () => {
    h.auth.userDoc = tutor();
    h.getDoc.mockImplementation((ref: { path: string }) => {
      if (ref.path === 'guardianLinks/t1') {
        return Promise.resolve({
          exists: () => true,
          data: () => ({ childUid: 't1', familyId: 'fam1', status: 'pending', origin: 'claim' }),
        });
      }
      return Promise.resolve({ exists: () => h.scheduleData != null, data: () => h.scheduleData });
    });
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/supervise your account/i)).toBeInTheDocument();
  });

  it('shows no supervision request card without a pending claim', async () => {
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
    expect(screen.queryByText(/supervise your account/i)).not.toBeInTheDocument();
  });

  // ── Hero priority (issue #120): first match wins ──

  it('hero: pending requests beat pending sessions and the next session', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    h.requests = [{ requestId: 'r1', tutorUserId: 't1', status: 'pending' }];
    h.sessions = [
      { sessionId: 's1', tutorUserId: 't1', status: 'pending' },
      {
        sessionId: 's2',
        tutorUserId: 't1',
        status: 'confirmed',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Cohen',
      },
    ];
    renderWithProviders(<DashboardPage />);

    const hero = await screen.findByRole('link', {
      name: /1 family request waiting for your answer/i,
    });
    expect(hero).toHaveAttribute('href', '/tutor/requests');
    expect(screen.queryByText(/awaiting confirmation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/next session/i)).not.toBeInTheDocument();
  });

  it('hero: pending sessions beat the next confirmed session', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    h.sessions = [
      { sessionId: 's1', tutorUserId: 't1', status: 'pending' },
      {
        sessionId: 's2',
        tutorUserId: 't1',
        status: 'confirmed',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Cohen',
      },
    ];
    renderWithProviders(<DashboardPage />);

    const hero = await screen.findByRole('link', { name: /1 session awaiting confirmation/i });
    expect(hero).toHaveAttribute('href', '/tutor/sessions');
    expect(screen.queryByText(/next session/i)).not.toBeInTheDocument();
  });

  it('hero: a confirmed future session alone → next-session hero to /tutor/sessions', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'confirmed',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Cohen',
      },
    ];
    renderWithProviders(<DashboardPage />);

    const hero = await screen.findByRole('link', { name: /next session/i });
    expect(hero).toHaveAttribute('href', '/tutor/sessions');
    expect(screen.getByText(/17:00/)).toBeInTheDocument();
    expect(screen.getByText(/Cohen/)).toBeInTheDocument();
  });

  it('hero: zero state renders no hero', async () => {
    h.auth.userDoc = tutor({ enrollmentComplete: true });
    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(
      screen.queryByText(/waiting for your answer|awaiting confirmation|next session/i),
    ).not.toBeInTheDocument();
  });
});
