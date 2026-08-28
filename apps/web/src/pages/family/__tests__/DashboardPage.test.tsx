import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Family dashboard tests.
//
// Since issue #241 the dashboard no longer renders the appointment lists
// inline: it keeps a SUMMARY card (counts + next upcoming confirmed
// appointment) that links to the dedicated /family/appointments page —
// mirroring study's tile → page pattern. The submitted-references
// subscription (and its H2 provability pin) moved to AppointmentsPage.test
// along with the lists.

const h = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  // Controllable appointments hook (summary counts only, on this page).
  apts: {
    pending: [] as unknown[],
    confirmed: [] as unknown[],
    pastRecent: [] as unknown[],
    rejectedRecent: [] as unknown[],
    loading: false,
  },
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
  addDoc: vi.fn(),
}));

// Controllable auth / verification stores + appointments hook.
const auth = { userDoc: null as unknown };
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/stores/verificationStore', () => ({
  useVerificationStore: () => ({ familyVerification: null, fetchStatus: vi.fn() }),
}));
vi.mock('@/hooks/useFamilyAppointments', () => ({
  useFamilyAppointments: () => h.apts,
}));

import i18n from '@/i18n';
import { render, cleanup, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FamilyDashboard } from '../DashboardPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <FamilyDashboard />
    </MemoryRouter>,
  );
}

// Some child components read localStorage at mount. jsdom in this config
// doesn't expose one, so provide a minimal in-memory stub.
function installLocalStorageStub() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
}

function apt(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    appointmentId: id,
    familyId: 'fam1',
    babysitterUserId: `bs-${id}`,
    status,
    date: '2026-09-01',
    startTime: '18:00',
    endTime: '21:00',
    ...extra,
  };
}

beforeEach(() => {
  installLocalStorageStub();
  i18n.changeLanguage('en');
  h.getDoc.mockReset();
  h.getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  h.getDocs.mockReset();
  h.getDocs.mockResolvedValue({ docs: [] });
  h.apts.pending = [];
  h.apts.confirmed = [];
  h.apts.pastRecent = [];
  h.apts.rejectedRecent = [];
  h.apts.loading = false;
  auth.userDoc = {
    uid: 'p1',
    firstName: 'Dana',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
});

afterEach(() => cleanup());

// ── Issue #241: appointments summary card → dedicated page ──
describe('family DashboardPage — appointments summary (issue #241)', () => {
  it('links the summary card to /family/appointments', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'View your appointments' });
    expect(link.getAttribute('href')).toBe('/family/appointments');
  });

  it('shows pending/upcoming counts and the next upcoming confirmed appointment', () => {
    h.apts.pending = [apt('a1', 'pending')];
    h.apts.confirmed = [
      apt('a2', 'confirmed', { date: '2026-09-05', startTime: '10:00', endTime: '12:00' }),
      apt('a3', 'confirmed', { date: '2026-09-01' }),
    ];
    renderPage();
    expect(screen.getByText('1 pending · 2 upcoming')).toBeTruthy();
    // The EARLIEST confirmed appointment claims the "Next" line (a3).
    expect(screen.getByText(/Next: Tue.*Sep.*18:00–21:00/)).toBeTruthy();
  });

  it('does NOT render the appointment list sections inline (they live on the page)', () => {
    h.apts.pending = [apt('a1', 'pending')];
    h.apts.confirmed = [apt('a2', 'confirmed')];
    renderPage();
    expect(screen.queryByText('Pending Requests')).toBeNull();
    expect(screen.queryByText('Confirmed')).toBeNull();
  });

  it('keeps the summary card, with the empty copy, when there are no appointments', () => {
    renderPage();
    expect(screen.getByText('No appointments yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View your appointments' })).toBeTruthy();
  });
});

// ── Issue #117 tier (a): refetch on window focus ──
// Representative wiring pin for sit web: appointments are live via onSnapshot
// (in the hook), so the page's remaining fetch-on-mount read (the family doc +
// kids load) re-runs when the user returns to the tab. The hook's
// throttle/listener behavior is unit-tested in shared-ui.
describe('family DashboardPage — refetch on focus (issue #117 tier a)', () => {
  beforeEach(() => {
    // Fake only Date: the throttle window is measured with Date.now(), while
    // waitFor/getDocs promises need real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-runs the kids load with IDENTICAL args when the window regains focus', async () => {
    renderPage();

    const kidsCalls = () =>
      h.getDocs.mock.calls.filter(
        (c) => (c[0] as { path?: string })?.path === 'families/fam1/kids',
      );
    await waitFor(() => expect(kidsCalls()).toHaveLength(1));

    // The user comes back to the tab after the throttle interval.
    vi.setSystemTime(new Date(Date.now() + 20_000));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(kidsCalls()).toHaveLength(2));
    // Identical query construction on refetch.
    expect(kidsCalls()[1][0]).toEqual(kidsCalls()[0][0]);
  });
});

// ── Issue #293: a removed co-parent (parent profile retained, familyId
// deleted by removeCoParent, #284) used to land on a silently empty
// dashboard. The family-less branch must explain the state and point at
// both recovery paths; a membered doc (either field) must never see it. ──
describe('family DashboardPage — family-less parent recovery state (issue #293)', () => {
  it('an ORPHAN parent doc sees the explanation and both recovery paths, not the empty dashboard', () => {
    auth.userDoc = {
      uid: 'p1',
      firstName: 'Dana',
      profiles: { parent: { enrollmentComplete: true } },
    };
    renderPage();
    expect(screen.getByText('You are not currently part of a family')).toBeTruthy();
    // Recovery path 1: the fresh-invite-link hint (the join page is the only
    // client path into the server's re-attach carve-out).
    expect(screen.getByText(/new invite link/)).toBeTruthy();
    // Recovery path 2: the enroll CTA targets the add-profile enrollment.
    const cta = screen.getByRole('link', { name: 'Start a new family' });
    expect(cta.getAttribute('href')).toBe('/enroll/parent');
    // The normal dashboard surfaces do NOT render underneath.
    expect(screen.queryByRole('link', { name: 'View your appointments' })).toBeNull();
  });

  it('a MEMBERED parent (profile familyId) never sees the family-less state', () => {
    renderPage(); // default beforeEach doc carries profiles.parent.familyId
    expect(screen.queryByText('You are not currently part of a family')).toBeNull();
    expect(screen.getByRole('link', { name: 'View your appointments' })).toBeTruthy();
  });

  it('a LEGACY Plan C doc (root familyId only) is a member, not an orphan', () => {
    auth.userDoc = {
      uid: 'p1',
      firstName: 'Dana',
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true } },
    };
    renderPage();
    expect(screen.queryByText('You are not currently part of a family')).toBeNull();
    expect(screen.getByRole('link', { name: 'View your appointments' })).toBeTruthy();
  });
});
