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
  // studyContactRequests docs for the New Requests section.
  requests: [] as Record<string, unknown>[],
  // study-sessions docs for the New Requests + Confirmed sections.
  sessions: [] as Record<string, unknown>[],
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
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  // The dashboard now hosts the published-searches preview, which subscribes
  // live; an inert unsubscribe keeps these appointment-focused tests unaware
  // of it (its own spec covers the section).
  onSnapshot: () => () => {},
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
  h.updateDoc.mockClear();
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.scheduleData != null, data: () => h.scheduleData })
  );
  h.where.mockClear();
  h.getDocs.mockReset();
  // Route by collection path: study-sessions => sessions, else => contact
  // requests. (Both section loads read by tutorUserId==me.)
  h.getDocs.mockImplementation((q: { query: { path: string }[] }) => {
    const path = q?.query?.[0]?.path;
    const rows = path === 'study-sessions' ? h.sessions : h.requests;
    return Promise.resolve({
      docs: rows.map((r) => ({ id: r.sessionId ?? r.requestId, data: () => r })),
    });
  });
}

describe('tutor DashboardPage', () => {
  beforeEach(() => reset());

  // ── Greeting (parity D1, issue #239) ──

  it('greets the tutor BY NAME — this page used to greet nobody', async () => {
    // Before #239 the header was a static t('tutor.dashboardTitle'), which
    // reads "Dashboard". The other three dashboards all used the reader's
    // name.
    h.auth.userDoc = { ...tutor(), firstName: 'claire' };
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Claire 👋');
  });

  it('a doc with no firstName greets plainly, never "Hello, Dashboard"', async () => {
    // The first cut of #239 passed t('tutor.dashboardTitle') as a fallback
    // NAME, producing "Hello, Dashboard 👋" / "Bonjour, Tableau de bord 👋"
    // (PR #249 review). The component now owns the no-name case.
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Hello 👋');
    expect(heading.textContent).not.toMatch(/dashboard/i);
  });

  // ── No verification surface (feature dropped, owner decision 2026-08-17) ──

  it('renders no verification banner, tile, or link anywhere', async () => {
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.queryByText(/verif/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upload your id/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/tutor/verification"]')).toBeNull();
  });

  it('legacy doc (enrollmentComplete=false): no visibility pill renders', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      enrollmentComplete: false,
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Inactive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Active' })).not.toBeInTheDocument();
  });

  // ── Activation gating (subjects + availability only), presented as sit's
  // top-right Active/Inactive pill + confirm dialog (owner request, PR #194) ──

  it('subjects but NO slots: the amber hint shows the availability guidance (fresh-enrollment state)', async () => {
    // The state a tutor lands in straight from enrollment (issue #242
    // dropped the success interstitial: the wizard collects subjects, not
    // availability) -- this banner IS the migrated next-steps guidance, so
    // it gets its own pin (PR #257 round 1).
    h.scheduleData = { weekly: {} };
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 25 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('button', { name: 'Inactive' })).toBeInTheDocument();
    // The FULL gate sentence -- 'Set your weekly availability' alone also
    // matches the always-rendered availability card (round-2 catch: the
    // loose regex could never fail).
    expect(
      await screen.findByText('Set your weekly availability before you can appear in search.'),
    ).toBeInTheDocument();
  });

  it('no subjects: pill is inert (no dialog) and the amber hint explains why', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      subjects: [],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const pill = await screen.findByRole('button', { name: 'Inactive' });
    // The amber hint waits on the async schedule read (scheduleLoaded); the
    // pill renders before it resolves, so query the hint asynchronously —
    // same race class as the confirm-dialog test's opacity wait (flaked on
    // PR #206's merge CI).
    expect(await screen.findByText(/add at least one subject/i)).toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.queryByText(/activate your profile/i)).not.toBeInTheDocument();
  });

  it('subjects + slots: pill opens the confirm dialog; confirming writes searchable=true', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const pill = await screen.findByRole('button', { name: 'Inactive' });
    // The pill renders before the async schedule read resolves and is inert
    // until canActivate flips; clicking too early is silently swallowed. The
    // pre-pill test synchronized on the toggle's disabled attribute — the
    // pill's equivalent is its dimmed (opacity-50) state clearing. Without
    // this wait the test raced CI and flaked (#199's merge-CI run).
    await waitFor(() => expect(pill.className).not.toContain('opacity-50'));
    fireEvent.click(pill);
    expect(await screen.findByText(/activate your profile/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ 'profiles.tutor.searchable': true })
      )
    );
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('no schedule slots: pill inert with the availability hint', async () => {
    h.scheduleData = null; // no schedule doc => no slots
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    const pill = await screen.findByRole('button', { name: 'Inactive' });
    await waitFor(() =>
      expect(screen.getByText(/set your weekly availability before/i)).toBeInTheDocument(),
    );
    fireEvent.click(pill);
    expect(screen.queryByText(/activate your profile/i)).not.toBeInTheDocument();
  });

  // ── Searchable-state rendering: the pill is the status tag ──

  it('searchable: renders the Active pill; deactivation goes through the dialog', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: true,
    });
    renderWithProviders(<DashboardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Active' }));
    expect(await screen.findByText(/deactivate your profile/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ 'profiles.tutor.searchable': false })
      )
    );
  });

  it('not searchable: renders the Inactive pill, no hint when the gate is met', async () => {
    h.scheduleData = { weekly: { tue: [true] } };
    h.auth.userDoc = tutor({
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      searchable: false,
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('button', { name: 'Inactive' })).toBeInTheDocument();
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.queryByText(/add at least one subject/i)).not.toBeInTheDocument();
  });

  // ── Issue #165 structure: install banner ──

  it('renders the install-app suggestion (base InstallAppBanner)', async () => {
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    expect(
      await screen.findByText(/install the app for the best experience/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /how to install/i })).toHaveAttribute(
      'href',
      '/install',
    );
  });

  // ── Issue #165 structure: availability box ──

  it('renders the My availability box linking to /tutor/schedule', async () => {
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    const box = await screen.findByRole('link', { name: /my availability/i });
    expect(box).toHaveAttribute('href', '/tutor/schedule');
  });

  // ── Issue #165 structure: New Requests section ──

  it('lists pending contact requests under New Requests, linking to /tutor/requests', async () => {
    h.auth.userDoc = tutor();
    h.requests = [
      {
        requestId: 'r1',
        tutorUserId: 't1',
        status: 'pending',
        familyName: 'Cohen',
        parentName: 'Dana',
        subject: 'math',
        level: '6e',
      },
      { requestId: 'r2', tutorUserId: 't1', status: 'accepted', familyName: 'Levi', parentName: 'Avi', subject: 'math', level: '6e' },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('New Requests')).toBeInTheDocument();
    const card = screen.getByText('Cohen').closest('a');
    expect(card).toHaveAttribute('href', '/tutor/requests');
    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    // Only the pending request counts; the accepted one renders nowhere.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Levi')).not.toBeInTheDocument();
  });

  it('a request THIS TUTOR sent renders marked, and does not count as a to-do', async () => {
    // Same rule the section already applies to tutor-authored session
    // proposals: it awaits the FAMILY, so it is not a to-do (issue #207 PR4).
    h.auth.userDoc = tutor();
    h.requests = [
      {
        requestId: 'r9',
        tutorUserId: 't1',
        status: 'pending',
        initiatedBy: 'tutor',
        publishedSearchId: 'ps1',
        familyName: 'Cohen',
        // Empty until a parent answers — it must not render a blank line.
        parentName: '',
        subject: 'math',
        level: '6e',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Cohen')).toBeInTheDocument();
    expect(screen.getByText(/waiting for their answer/i)).toBeInTheDocument();
    // The amber to-do badge stays at zero; the section still shows the row.
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('lists pending session bookings under New Requests, linking to /tutor/sessions', async () => {
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'pending',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        endTime: '18:00',
        familyName: 'Martin',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('New Requests')).toBeInTheDocument();
    const card = screen.getByText('Martin').closest('a');
    expect(card).toHaveAttribute('href', '/tutor/sessions');
    expect(screen.getByText(/17:00–18:00/)).toBeInTheDocument();
  });

  it("marks the tutor's own pending proposal as awaiting the family", async () => {
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'pending',
        proposedBy: 'provider',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Martin',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/awaiting the family/i)).toBeInTheDocument();
  });

  // ── Issue #165 structure: Confirmed section ──

  it('lists upcoming confirmed sessions under Confirmed, linking to /tutor/sessions', async () => {
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'confirmed',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        endTime: '18:00',
        familyName: 'Cohen',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    const card = screen.getByText('Cohen').closest('a');
    expect(card).toHaveAttribute('href', '/tutor/sessions');
    expect(screen.getByText(/17:00–18:00/)).toBeInTheDocument();
    expect(screen.getByText(/online/i)).toBeInTheDocument();
    // No New Requests section without anything pending.
    expect(screen.queryByText('New Requests')).not.toBeInTheDocument();
  });

  it('shows a confirmed recurring series with its weekly slot line (no instances query)', async () => {
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'confirmed',
        type: 'recurring',
        recurringSlots: [{ day: 'tue', startTime: '17:00', endTime: '18:00' }],
        startTime: '17:00',
        familyName: 'Dupont',
        subject: 'math',
        level: '6e',
        location: 'family_home',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/every tuesday 17:00–18:00/i)).toBeInTheDocument();
    // The instances subcollection is never queried — parent docs only.
    const paths = h.getDocs.mock.calls.map(
      (c) => (c[0] as { query?: { path?: string }[] })?.query?.[0]?.path ?? '',
    );
    expect(paths.every((p) => p === 'study-sessions' || p === 'studyContactRequests')).toBe(true);
  });

  it('excludes past and terminal sessions from Confirmed', async () => {
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'confirmed',
        type: 'one_time',
        date: '2000-01-01',
        startTime: '17:00',
        familyName: 'Old',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
      {
        sessionId: 's2',
        tutorUserId: 't1',
        status: 'declined',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Nope',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    renderWithProviders(<DashboardPage />);

    // Settle on the empty state — nothing upcoming, nothing pending.
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
    expect(screen.queryByText('Nope')).not.toBeInTheDocument();
  });

  // ── Empty + loading states ──

  it("the tutor's own proposal renders but stays out of the amber badge count", async () => {
    // The badge is a to-do count: proposals the tutor sent await the FAMILY's
    // answer, so with one family booking + one own proposal the badge says 1
    // while both rows render (PR #194 review).
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'pending',
        proposedBy: 'provider',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Martin',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
      {
        sessionId: 's2',
        tutorUserId: 't1',
        status: 'pending',
        type: 'one_time',
        date: '2099-01-02',
        startTime: '10:00',
        familyName: 'Bernard',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('New Requests')).toBeInTheDocument();
    expect(screen.getByText('Martin')).toBeInTheDocument();
    expect(screen.getByText('Bernard')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('2')).toBeNull();
  });

  it('a tutor whose only pending item is their own proposal still sees it (no badge)', async () => {
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'pending',
        proposedBy: 'provider',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Martin',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Martin')).toBeInTheDocument();
    expect(screen.getByText(/awaiting the family/i)).toBeInTheDocument();
    // Zero-count badge suppressed; the section itself must NOT collapse into
    // the empty state.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(/no requests yet/i)).toBeNull();
  });

  it('excludes past-dated pending one_time bookings from New Requests', async () => {
    // Nothing server-side expires a pending booking; without the date floor a
    // never-answered request sits in the to-do list forever (PR #194 review).
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'pending',
        type: 'one_time',
        date: '2020-01-01',
        startTime: '17:00',
        familyName: 'Martin',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Martin')).toBeNull();
  });

  it('shows an error line instead of an eternal spinner when the first load fails', async () => {
    // Both reads swallow rejections and keep state null; without an error
    // branch `loading` never clears and the only recovery is a throttled
    // blur/refocus (PR #194 review; SessionsPage's loadError pattern).
    h.auth.userDoc = tutor();
    h.getDocs.mockImplementation(() => Promise.reject(new Error('offline')));
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/could not load your dashboard/i)).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByText(/no requests yet/i)).toBeNull();
  });

  it('a PARTIAL failure also surfaces the error line (the success must not erase it)', async () => {
    // One flag per load: with a shared flag cleared on any success, a
    // requests failure followed by a sessions success left loading=true and
    // loadError=false — the eternal spinner again (PR #194 review round 2).
    h.auth.userDoc = tutor();
    const defaultImpl = h.getDocs.getMockImplementation()!;
    h.getDocs.mockImplementation((q: { query: { path: string }[] }) =>
      q?.query?.[0]?.path === 'study-sessions'
        ? defaultImpl(q)
        : Promise.reject(new Error('permission-denied')),
    );
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/could not load your dashboard/i)).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('renders the empty state when nothing is pending or upcoming', async () => {
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/when families contact you or book sessions/i),
    ).toBeInTheDocument();
  });

  it('paints neither sections nor the empty state while a snapshot is in flight', async () => {
    // The two queries resolve independently; rendering on a still-null
    // requests list would paint the empty state (or a partial section) and
    // then visibly swap. The page must wait for BOTH snapshots.
    h.auth.userDoc = tutor();
    h.sessions = [
      {
        sessionId: 's1',
        tutorUserId: 't1',
        status: 'pending',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        familyName: 'Martin',
        subject: 'math',
        level: '6e',
        location: 'online',
      },
    ];
    const defaultImpl = h.getDocs.getMockImplementation()!;
    h.getDocs.mockImplementation((q: { query?: { path: string }[] }) => {
      const path = q?.query?.[0]?.path ?? '';
      if (path === 'studyContactRequests') return new Promise(() => {});
      return defaultImpl(q);
    });
    renderWithProviders(<DashboardPage />);

    // Settle on the availability box (renders regardless of the snapshots)...
    await screen.findByRole('link', { name: /my availability/i });
    // ...but neither the sections nor the empty state paint early.
    expect(screen.queryByText('New Requests')).not.toBeInTheDocument();
    expect(screen.queryByText(/no requests yet/i)).not.toBeInTheDocument();
  });

  // ── Issue #165: tiles relegated to the hamburger menu do NOT render here ──

  it('renders no endorsements, subjects & rates, or account tiles', async () => {
    h.auth.userDoc = tutor();
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('link', { name: /my availability/i });
    expect(document.querySelector('a[href="/tutor/endorsements"]')).toBeNull();
    expect(document.querySelector('a[href="/tutor/subjects"]')).toBeNull();
    expect(document.querySelector('a[href="/tutor/account"]')).toBeNull();
    expect(screen.queryByText(/subjects & rates/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/endorsements/i)).not.toBeInTheDocument();
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
});
