import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Family dashboard tests.
//
// Issue #338 restores the two live lists to the landing page — as the
// babysitter dashboard's collapsible SECTIONS ("Your requests" = pending,
// "Your appointments" = confirmed), replacing the single summary card of
// issue #241. The dedicated /family/appointments page still owns every action
// and the past/declined history, so the rows here only navigate to it; the
// submitted-references subscription stays on AppointmentsPage.test.

const h = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  // Controllable appointments hook (the two sections read pending/confirmed).
  apts: {
    pending: [] as unknown[],
    confirmed: [] as unknown[],
    pastRecent: [] as unknown[],
    rejectedRecent: [] as unknown[],
    loading: false,
    loadError: false,
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
import { render, cleanup, screen, waitFor, act, fireEvent } from '@testing-library/react';
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

/** Paris "YYYY-MM-DD" for today + N days — the same wall-clock the page reads,
 * so the date floor holds in any test-runner timezone. */
function parisDatePlus(days: number): string {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = todayStr.split('-').map(Number);
  const shifted = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

/** The "d MMM" fragment the row renders for a given ISO date. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
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
  h.apts.loadError = false;
  auth.userDoc = {
    uid: 'p1',
    firstName: 'Dana',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
});

afterEach(() => cleanup());

// ── Issue #338: the landing page carries the provider-style sections ──
describe('family DashboardPage — requests & appointments sections (issue #338)', () => {
  // The page drops past-dated pending rows, so every assertion here depends on
  // where "now" sits relative to the fixture dates. Two things follow, and the
  // frozen clock fixes both (PR #345 review):
  //   1. Hardcoded fixture dates are a time bomb — '2026-09-01' stops being a
  //      future date on 2026-09-02 and the rows silently vanish.
  //   2. Left on the real clock these tests are FLAKY, not merely doomed: on a
  //      full-suite run they fail intermittently (observed 3 failures in one
  //      run, 0 in the next, same commit), because the wall clock this block
  //      reads is not isolated from the rest of the suite.
  // Only Date is faked; waitFor and the getDocs promises need real timers,
  // matching the focus-refetch block below.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-29T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the two section headers over real rows', () => {
    h.apts.pending = [apt('a1', 'pending')];
    h.apts.confirmed = [apt('a2', 'confirmed', { date: '2026-09-05', startTime: '10:00', endTime: '12:00' })];
    renderPage();
    // DashboardSection puts the count badge inside the toggle deliberately, so
    // the accessible name of a badged section is "Your appointments1". Match a
    // prefix rather than asserting a name the component never produces.
    expect(screen.getByRole('heading', { name: /^Your requests/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Your appointments/ })).toBeTruthy();
    // Each row carries its own date/time line...
    expect(screen.getByText(/Tue.*1 Sep.*· 18:00–21:00/)).toBeTruthy();
    expect(screen.getByText(/Sat.*5 Sep.*· 10:00–12:00/)).toBeTruthy();
    // ...and the tile-era summary line is gone.
    expect(screen.queryByText('1 pending · 1 upcoming')).toBeNull();
  });

  it('has NO standalone summary button left — the rows are the entry point', () => {
    h.apts.confirmed = [apt('a2', 'confirmed')];
    renderPage();
    expect(screen.queryByRole('link', { name: 'View your appointments' })).toBeNull();
    // The row itself navigates to the page that owns the actions.
    expect(screen.getByText(/Tue.*1 Sep/).closest('a')?.getAttribute('href')).toBe(
      '/family/appointments',
    );
  });

  it('badges only what the FAMILY must answer on the requests section', () => {
    // A request we sent is waiting on the babysitter; only one a babysitter
    // opened by answering our published search is a to-do (issue #207 PR3).
    h.apts.pending = [
      apt('a1', 'pending', { initiatedBy: 'babysitter' }),
      apt('a2', 'pending', { date: '2026-09-02' }),
    ];
    renderPage();
    expect(screen.getByText('Answered your published search')).toBeTruthy();
    expect(screen.getByText('Waiting for the babysitter to reply.')).toBeTruthy();
    // Both rows render; the badge counts one.
    expect(screen.getByText(/Tue.*1 Sep.*· 18:00–21:00/)).toBeTruthy();
    expect(screen.getByText(/Wed.*2 Sep.*· 18:00–21:00/)).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('renders an all-outgoing requests section with no badge at all', () => {
    // `total` gates the section, `count` only the badge.
    h.apts.pending = [apt('a1', 'pending')];
    renderPage();
    expect(screen.getByRole('heading', { name: /^Your requests/ })).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
  });

  it('sorts rows soonest-first and renders a recurring appointment by its weekly slots', () => {
    h.apts.confirmed = [
      apt('a1', 'confirmed', { date: '2026-09-20', startTime: '09:00', endTime: '10:00' }),
      apt('a2', 'confirmed', {
        date: undefined,
        recurringSlots: [{ day: 'mon', startTime: '17:00', endTime: '19:00' }],
      }),
      apt('a3', 'confirmed', { date: '2026-09-02', startTime: '08:00', endTime: '09:00' }),
    ];
    renderPage();
    const lines = screen.getAllByText(/Sep|Mon 17:00/).map((n) => n.textContent);
    // Concrete dates ascending; the recurring row (no single date) sorts last.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/Wed.*2 Sep.*· 08:00–09:00/);
    expect(lines[1]).toMatch(/Sun.*20 Sep.*· 09:00–10:00/);
    expect(lines[2]).toBe('Mon 17:00–19:00');
  });

  it('drops a past-dated pending request — nothing server-side expires one', () => {
    // useFamilyAppointments gives `pending` no date treatment (only CONFIRMED
    // docs get bucketed into pastRecent), and cleanupOldData documents pending
    // retention as deliberately unbounded. Sorted soonest-first, a request for
    // a date that has passed would otherwise pin itself to the FIRST row
    // forever (PR #345 review). A recurring request has no date and stays.
    h.apts.pending = [
      apt('a-old', 'pending', { date: parisDatePlus(-5) }),
      apt('a-soon', 'pending', { date: parisDatePlus(5) }),
      apt('a-recurring', 'pending', {
        date: undefined,
        recurringSlots: [{ day: 'mon', startTime: '17:00', endTime: '19:00' }],
      }),
    ];
    renderPage();
    expect(screen.getByRole('heading', { name: /^Your requests/ })).toBeTruthy();
    // The future request and the dateless recurring one render...
    expect(screen.getByText(new RegExp(shortDate(parisDatePlus(5))))).toBeTruthy();
    expect(screen.getByText('Mon 17:00–19:00')).toBeTruthy();
    // ...the past-dated one does not, so it cannot claim the first row.
    expect(screen.queryByText(new RegExp(shortDate(parisDatePlus(-5))))).toBeNull();
  });

  it('collapses a section when its header is clicked', () => {
    h.apts.confirmed = [apt('a2', 'confirmed')];
    renderPage();
    const header = screen.getByRole('button', { name: /your appointments/i });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Tue.*1 Sep/)).toBeNull();
  });

  it('shows one empty state, and no sections, when there is nothing booked', () => {
    renderPage();
    expect(screen.getByText('No appointments yet')).toBeTruthy();
    // Prefix, not exact: a badged section's accessible name is
    // "Your appointments1", so an exact-name query can never match and the
    // assertion would pass even if the section HAD rendered.
    expect(screen.queryByRole('heading', { name: /^Your requests/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Your appointments/ })).toBeNull();
  });

  it('says so when the subscription fails, instead of skeletons forever', () => {
    // An erroring onSnapshot used to leave `loading` true with no error
    // branch, so this page showed three skeletons indefinitely with no way
    // out (PR #345 round 4). Study's half had said so since round 1.
    h.apts.loading = true;
    h.apts.loadError = true;
    renderPage();
    expect(screen.getByText(/could not load your requests and appointments/i)).toBeTruthy();
  });

  it('a refetch blip over rendered rows stays invisible', () => {
    // Same rule as study: the error line belongs to the first read, not to a
    // blip over content that is already on screen.
    h.apts.confirmed = [apt('a1', 'confirmed')];
    h.apts.loadError = true;
    renderPage();
    expect(screen.getByRole('heading', { name: /^Your appointments/ })).toBeTruthy();
    expect(screen.queryByText(/could not load/i)).toBeNull();
  });

  it('does not flash the empty state while the snapshot is still loading', () => {
    h.apts.loading = true;
    renderPage();
    expect(screen.queryByText('No appointments yet')).toBeNull();
  });

  it('keeps past and declined history off the landing page', () => {
    // pastRecent / rejectedRecent are deliberately not read here — they live
    // on /family/appointments, reached from the hamburger menu.
    h.apts.pastRecent = [apt('a4', 'completed', { date: '2020-01-01' })];
    h.apts.rejectedRecent = [apt('a5', 'rejected', { date: '2020-01-02' })];
    renderPage();
    expect(screen.getByText('No appointments yet')).toBeTruthy();
    expect(screen.queryByText(/2020/)).toBeNull();
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
    expect(screen.queryByText('No appointments yet')).toBeNull();
  });

  it('a MEMBERED parent (profile familyId) never sees the family-less state', () => {
    renderPage(); // default beforeEach doc carries profiles.parent.familyId
    expect(screen.queryByText('You are not currently part of a family')).toBeNull();
    expect(screen.getByText('No appointments yet')).toBeTruthy();
  });

  it('a LEGACY Plan C doc (root familyId only) is a member, not an orphan', () => {
    auth.userDoc = {
      uid: 'p1',
      firstName: 'Dana',
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true } },
    };
    h.apts.confirmed = [apt('a1', 'confirmed')];
    renderPage();
    expect(screen.queryByText('You are not currently part of a family')).toBeNull();
    // The rows load, so the empty state is never claimed. This used to assert
    // 'No appointments yet' — pinning an affirmative statement that could be
    // flatly false for a family with live appointments, and one the new empty
    // state does not even link away from (PR #345 round 3).
    expect(screen.getByRole('heading', { name: /^Your appointments/ })).toBeTruthy();
    expect(screen.queryByText('No appointments yet')).toBeNull();
  });
});
