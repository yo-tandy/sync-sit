import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The family dashboard reads the auth store
// for the parent profile (greeting + familyId) and loads families/{familyId}
// directly for the verification gate; both are driven through `h`.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
    userDoc: null as unknown,
  },
  // What getDoc(families/{id}) resolves to. null => doc absent.
  familyData: null as { familyName?: string; verification?: { isFullyVerified?: boolean } } | null,
  // studyContactRequests docs behind the "Your requests" section.
  requests: [] as Record<string, unknown>[],
  // study-sessions docs behind the "Your sessions" section.
  sessions: [] as Record<string, unknown>[],
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
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { DashboardPage } from '../DashboardPage';

/** Paris "YYYY-MM-DD" for today + N days — the same wall-clock the component
 * reads, so the date floor holds in any test-runner timezone. */
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

/** A confirmed one_time session doc unless overridden. */
function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    familyId: 'fam1',
    status: 'confirmed',
    type: 'one_time',
    date: '2099-01-01',
    startTime: '17:00',
    endTime: '18:00',
    subject: 'math',
    level: '3e',
    tutorName: 'Leo',
    ...overrides,
  };
}

/** A pending family-initiated contact request unless overridden. */
function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'r1',
    familyId: 'fam1',
    status: 'pending',
    subject: 'math',
    level: '3e',
    tutorName: 'Sarah',
    ...overrides,
  };
}

function parent(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'p1',
    firstName: 'Dana',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1', ...overrides } },
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 'p1' };
  h.auth.userDoc = parent();
  h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: false } };
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.familyData != null, data: () => h.familyData }),
  );
  h.requests = [];
  h.sessions = [];
  h.where.mockClear();
  h.getDocs.mockReset();
  // Route by collection path: study-sessions vs studyContactRequests.
  h.getDocs.mockImplementation((q: { query?: { path: string }[] }) => {
    const path = q?.query?.[0]?.path ?? '';
    if (path === 'study-sessions') {
      return Promise.resolve({ docs: h.sessions.map((s) => ({ id: s.sessionId, data: () => s })) });
    }
    return Promise.resolve({ docs: h.requests.map((r) => ({ id: r.requestId, data: () => r })) });
  });
}

describe('family DashboardPage', () => {
  beforeEach(() => reset());

  it('greets the parent by first name', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/Dana/)).toBeInTheDocument();
  });

  it('opts into the wide desktop tier on its root (issue #119)', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/Dana/).closest('[data-page-width="wide"]')).not.toBeNull();
  });

  it('greets in the shared idiom, with the family context line (parity D1, #239)', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Dana 👋');
    expect(await screen.findByText('COHEN family')).toBeInTheDocument();
  });

  it('omits the context line when the family doc carries no name', async () => {
    h.familyData = { verification: { isFullyVerified: true } };
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Dana 👋');
    await waitFor(() => expect(screen.queryByText(/family$/)).not.toBeInTheDocument());
  });

  it('shows the verification banner when the family is not fully verified', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: false } };
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /complete verification/i })).toHaveAttribute(
      'href',
      '/family/verification',
    );
    // No search button while unverified.
    expect(screen.queryByRole('button', { name: /find a tutor/i })).not.toBeInTheDocument();
  });

  it('treats an absent verification field as not verified (banner shown)', async () => {
    h.familyData = { familyName: 'Cohen' }; // no verification => not verified
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
  });

  // ── Issue #338: one "Find a tutor" button over two sections ──

  it('shows the find-a-tutor button (and hides the banner) when fully verified', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    renderWithProviders(<DashboardPage />);
    // A real <button>, not a <button> nested inside an <a> — invalid HTML and
    // an ARIA nested-interactive violation (PR #345 review). Same markup as
    // sit's search CTA, which is the layout this page is matching.
    const cta = await screen.findByRole('button', { name: /find a tutor/i });
    expect(cta.closest('a')).toBeNull();
    expect(screen.queryByText(/verify your family/i)).not.toBeInTheDocument();
  });

  it('renders search exactly ONCE — it is a button now, never also a tile', async () => {
    // The old layout duplicated search between the hero and the tile grid and
    // needed a guard to suppress one of them; there is only one entry now.
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.sessions = [session()];
    renderWithProviders(<DashboardPage />);
    await screen.findByText('Your sessions');
    expect(screen.getAllByRole('button', { name: /find a tutor/i })).toHaveLength(1);
  });

  it('the search button survives a failed requests read (it is the only way into search)', async () => {
    // FamilyAppBar has no /family/search item — this page is the only way in,
    // so the button must not sit behind a snapshot that can fail.
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.getDocs.mockImplementation((q: { query?: { path: string }[] }) => {
      const path = q?.query?.[0]?.path ?? '';
      if (path === 'studyContactRequests') return Promise.reject(new Error('offline'));
      return Promise.resolve({ docs: [] });
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findAllByRole('button', { name: /find a tutor/i })).toHaveLength(1);
  });

  it('renders the two SECTIONS with rows, replacing the old summary tiles', async () => {
    h.requests = [request({ requestId: 'r1', tutorName: 'Sarah' })];
    h.sessions = [session({ sessionId: 's1', tutorName: 'Leo' })];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole('heading', { name: /Your requests/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Your sessions/ })).toBeInTheDocument();
    // Real rows, not a count line: the tutor's name and the row's subject.
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('Leo')).toBeInTheDocument();
    expect(screen.getAllByText('Mathematics · 3e')).toHaveLength(2);
    // The tile-era count lines are gone.
    expect(screen.queryByText('1 pending · 0 accepted')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 pending · 1 upcoming/)).not.toBeInTheDocument();
    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
  });

  it('rows navigate to the pages that own the actions', async () => {
    h.requests = [request({ requestId: 'r1', tutorName: 'Sarah' })];
    h.sessions = [session({ sessionId: 's1', tutorName: 'Leo' })];
    renderWithProviders(<DashboardPage />);

    expect((await screen.findByText('Sarah')).closest('a')).toHaveAttribute(
      'href',
      '/family/requests',
    );
    expect(screen.getByText('Leo').closest('a')).toHaveAttribute('href', '/family/sessions');
  });

  it('badges only what the FAMILY must answer: a tutor-initiated request counts, ours does not', async () => {
    // Same rule as the tutor dashboard: the badge is a to-do count, so a
    // request we sent renders (marked "waiting for the tutor") without
    // inflating it (issue #207 PR4).
    h.requests = [
      request({ requestId: 'r1', initiatedBy: 'tutor', tutorName: 'Sarah' }),
      request({ requestId: 'r2', tutorName: 'Marc' }),
    ];
    renderWithProviders(<DashboardPage />);

    await screen.findByRole('heading', { name: /Your requests/ });
    // Both rows show...
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('Marc')).toBeInTheDocument();
    // ...but only the tutor-initiated one is a to-do.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/answered your published search/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for the tutor to reply/i)).toBeInTheDocument();
  });

  it('renders a section whose rows are ALL waiting on the other side (no badge, still visible)', async () => {
    // `total` gates the section, `count` only the badge — a family with one
    // outgoing request must still see it.
    h.requests = [request({ requestId: 'r1', tutorName: 'Marc' })];
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('heading', { name: /Your requests/ })).toBeInTheDocument();
    expect(screen.getByText('Marc')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('puts a tutor PROPOSAL in the amber requests section, where the to-do badge sees it', async () => {
    // Round 3: folded into the green sessions row count, a proposal — an
    // action awaiting THIS family — had no badge representation anywhere, so
    // collapsing the section made it indistinguishable from confirmed work.
    // sit and both providers already put pending rows in the amber section.
    h.sessions = [session({ sessionId: 's1', status: 'pending', proposedBy: 'provider' })];
    renderWithProviders(<DashboardPage />);

    const requests = await screen.findByRole('heading', { name: /Your requests/ });
    expect(requests).toHaveTextContent('1');
    expect(screen.getByText('Proposed by Leo')).toBeInTheDocument();
    // ...and it is NOT in the sessions section, which is confirmed-only now.
    expect(screen.queryByRole('heading', { name: /Your sessions/ })).not.toBeInTheDocument();
  });

  it('a booking WE sent renders in requests, marked, without inflating the badge', async () => {
    h.sessions = [session({ sessionId: 's1', status: 'pending' })];
    renderWithProviders(<DashboardPage />);
    const requests = await screen.findByRole('heading', { name: /Your requests/ });
    expect(screen.getByText(/waiting for the tutor to confirm/i)).toBeInTheDocument();
    expect(requests).not.toHaveTextContent('1');
  });

  it('badges the sessions section with its ROW COUNT, as sit and both providers do', async () => {
    // The badge rule across all four dashboards: an AMBER section badges what
    // you must answer, a GREEN section badges how many rows it holds.
    h.sessions = [
      session({ sessionId: 's1' }),
      session({ sessionId: 's2', date: '2099-02-02' }),
      session({ sessionId: 's3', date: '2099-03-03' }),
    ];
    renderWithProviders(<DashboardPage />);
    const heading = await screen.findByRole('heading', { name: /Your sessions/ });
    expect(heading).toHaveTextContent('3');
  });

  it('keeps confirmed sessions OUT of the requests section', async () => {
    h.sessions = [session({ sessionId: 's1' })];
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('heading', { name: /Your sessions/ });
    expect(screen.queryByRole('heading', { name: /Your requests/ })).not.toBeInTheDocument();
  });

  it('drops a past-dated PENDING booking, the same floor the confirmed rows get', async () => {
    // Nothing server-side expires an unanswered booking, so without the floor
    // it would sit in the requests section forever with a past date.
    h.sessions = [
      session({ sessionId: 's-old', status: 'pending', date: parisDatePlus(-4), tutorName: 'Old' }),
      session({ sessionId: 's-new', status: 'pending', date: parisDatePlus(4), tutorName: 'Soon' }),
    ];
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('heading', { name: /Your requests/ });
    expect(screen.getByText('Soon')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('orders the requests section newest-first, contact requests before bookings', async () => {
    // Round 3: two adjacent sections order by different principles — a contact
    // request has no date, so recency is the only meaningful key, while the
    // sessions section sorts soonest-first. Deliberate, and pinned so a
    // refactor cannot silently change it.
    h.requests = [
      request({ requestId: 'r-old', tutorName: 'Older', createdAt: { seconds: 1000 } }),
      request({ requestId: 'r-new', tutorName: 'Newer', createdAt: { seconds: 2000 } }),
    ];
    h.sessions = [session({ sessionId: 's1', status: 'pending', tutorName: 'Booking' })];
    renderWithProviders(<DashboardPage />);

    await screen.findByRole('heading', { name: /Your requests/ });
    const names = screen.getAllByText(/^(Older|Newer|Booking)$/).map((n) => n.textContent);
    expect(names).toEqual(['Newer', 'Older', 'Booking']);
  });

  it('sorts sessions soonest-first and renders a recurring series by its weekly slot', async () => {
    h.sessions = [
      session({ sessionId: 's1', date: '2099-02-01', startTime: '18:00', tutorName: 'Later' }),
      session({
        sessionId: 's2',
        type: 'recurring',
        date: undefined,
        recurringSlots: [{ day: 'mon', startTime: '17:00', endTime: '18:00' }],
        tutorName: 'Series',
      }),
      session({ sessionId: 's3', date: '2099-01-01', startTime: '09:00', tutorName: 'Sooner' }),
    ];
    renderWithProviders(<DashboardPage />);

    await screen.findByRole('heading', { name: /Your sessions/ });
    const names = screen.getAllByText(/^(Later|Series|Sooner)$/).map((n) => n.textContent);
    // Concrete dates ascending; the series (no single date) sorts last.
    expect(names).toEqual(['Sooner', 'Later', 'Series']);
    expect(screen.getByText('Every Monday 17:00–18:00')).toBeInTheDocument();
  });

  it('orders same-day sessions by start time, not by when they were booked', async () => {
    // sort() is stable, so a bare-date key would keep loadSessions'
    // createdAt-DESCENDING order for two sessions on the same day (PR #345
    // review). The later-booked 17:00 must still render after the 09:00.
    h.sessions = [
      session({
        sessionId: 's-late',
        date: '2099-03-10',
        startTime: '17:00',
        tutorName: 'Evening',
        createdAt: { seconds: 2000 },
      }),
      session({
        sessionId: 's-early',
        date: '2099-03-10',
        startTime: '09:00',
        tutorName: 'Morning',
        createdAt: { seconds: 1000 },
      }),
    ];
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('heading', { name: /Your sessions/ });
    const names = screen.getAllByText(/^(Evening|Morning)$/).map((n) => n.textContent);
    expect(names).toEqual(['Morning', 'Evening']);
  });

  it('bounds the accepted requests by recency, and keeps a timestamp-less legacy doc', async () => {
    // `accepted` is terminal and carries no date, so without a bound this
    // section grows forever (PR #345 review). PAST_VISIBILITY_DAYS is 7.
    const nowSeconds = Date.now() / 1000;
    h.requests = [
      request({
        requestId: 'r-recent',
        status: 'accepted',
        tutorName: 'Recent',
        respondedAt: { seconds: nowSeconds - 2 * 24 * 60 * 60 },
      }),
      request({
        requestId: 'r-stale',
        status: 'accepted',
        tutorName: 'Stale',
        respondedAt: { seconds: nowSeconds - 30 * 24 * 60 * 60 },
      }),
      // No respondedAt/updatedAt at all: kept rather than silently vanished.
      request({ requestId: 'r-legacy', status: 'accepted', tutorName: 'Legacy' }),
    ];
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('heading', { name: /Your requests/ });
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('keeps an old PENDING request — only accepted rows are bounded', async () => {
    // A pending request is still actionable, so the recency bound must not
    // reach it.
    h.requests = [
      request({
        requestId: 'r1',
        tutorName: 'Waiting',
        createdAt: { seconds: Date.now() / 1000 - 90 * 24 * 60 * 60 },
      }),
    ];
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('heading', { name: /Your requests/ });
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  it('drops a past one_time session from the sessions section', async () => {
    // Nothing server-side expires an unanswered booking, so a date floor keeps
    // last month's request out of the landing page.
    h.sessions = [
      session({ sessionId: 's1', date: parisDatePlus(-3), tutorName: 'Old' }),
      session({ sessionId: 's2', date: parisDatePlus(3), tutorName: 'Soon' }),
    ];
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('heading', { name: /Your sessions/ });
    expect(screen.getByText('Soon')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('keeps declined/cancelled request history off the landing page', async () => {
    h.requests = [
      request({ requestId: 'r1', status: 'declined', tutorName: 'Dora' }),
      request({ requestId: 'r2', status: 'cancelled', tutorName: 'Cleo' }),
      request({ requestId: 'r3', status: 'accepted', tutorName: 'Ada' }),
    ];
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('heading', { name: /Your requests/ });
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.queryByText('Dora')).not.toBeInTheDocument();
    expect(screen.queryByText('Cleo')).not.toBeInTheDocument();
  });

  it('collapses a section when its header is clicked', async () => {
    h.requests = [request({ requestId: 'r1', tutorName: 'Sarah' })];
    renderWithProviders(<DashboardPage />);

    await screen.findByText('Sarah');
    const header = screen.getByRole('button', { name: /your requests/i });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Sarah')).not.toBeInTheDocument();
  });

  it('shows one empty state when the family has neither requests nor sessions', async () => {
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('Nothing booked yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Your requests/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Your sessions/ })).not.toBeInTheDocument();
  });

  it('does not flash the empty state while the snapshots are still loading', () => {
    h.getDocs.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<DashboardPage />);
    expect(screen.queryByText('Nothing booked yet')).not.toBeInTheDocument();
  });

  it('keeps the empty-state instruction truthful when search is locked', async () => {
    // "Find a tutor to send your first request" is a dead instruction when the
    // Find-a-tutor button is not on screen — and unverified is the TYPICAL
    // first-visit state (PR #345 round 4).
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: false } };
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('Nothing booked yet')).toBeInTheDocument();
    expect(screen.getByText(/once your family is verified/i)).toBeInTheDocument();
    expect(screen.queryByText(/find a tutor to send your first request/i)).not.toBeInTheDocument();
  });

  it('gives the actionable instruction once verified', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/find a tutor to send your first request/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find a tutor/i })).toBeInTheDocument();
  });

  it('says so when the FIRST read fails, instead of spinning forever', async () => {
    h.getDocs.mockImplementation(() => Promise.reject(new Error('offline')));
    renderWithProviders(<DashboardPage />);
    expect(
      await screen.findByText(/could not load your requests and sessions/i),
    ).toBeInTheDocument();
  });

  it('a refetch blip keeps last-known-good rows and the verified state', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.requests = [request({ requestId: 'r1', tutorName: 'Sarah' })];
    h.sessions = [session({ sessionId: 's1', tutorName: 'Leo' })];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('Leo')).toBeInTheDocument();

    // Network blip: every read now fails; the user returns to the tab.
    h.getDoc.mockImplementation(() => Promise.reject(new Error('unavailable')));
    h.getDocs.mockImplementation(() => Promise.reject(new Error('unavailable')));
    await act(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 20_000));
      window.dispatchEvent(new Event('focus'));
      vi.useRealTimers();
    });

    // Rows intact, still verified, and no error banner over rendered content.
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('Leo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find a tutor/i })).toBeInTheDocument();
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });

  it('has no standalone destination buttons left — the menu owns them (issue #338)', async () => {
    // "Remove all of the buttons into the sections": governance, family
    // settings and account were half-weight tiles here and are hamburger-menu
    // entries (see FamilyAppBar), so the landing page no longer repeats them.
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.sessions = [session()];
    renderWithProviders(<DashboardPage />);

    await screen.findByRole('heading', { name: /Your sessions/ });
    expect(screen.queryByRole('link', { name: /supervised kids/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /family settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^account\b/i })).not.toBeInTheDocument();
    // ...and no hero card either: the sections say it by showing the rows.
    expect(screen.queryByText(/next session/i)).not.toBeInTheDocument();
  });
});

// ── Issue #293: a removed co-parent (parent profile retained, familyId
// deleted by removeCoParent in the Sync/Sit app, #284 — same shared user
// doc) used to land on a silently empty dashboard here too. The family-less
// branch must explain the state and point at the recovery paths; a membered
// doc (either membership field) must never see it. ──
describe('family DashboardPage — family-less parent recovery state (issue #293)', () => {
  beforeEach(() => reset());

  it('an ORPHAN parent doc sees the explanation and recovery paths, not the sections', () => {
    h.auth.userDoc = {
      uid: 'p1',
      firstName: 'Dana',
      profiles: { parent: { enrollmentComplete: true } },
    };
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('You are not currently part of a family')).toBeInTheDocument();
    // Recovery path 1: the fresh-invite-link hint (accepted in Sync/Sit).
    expect(screen.getByText(/new invite link/)).toBeInTheDocument();
    // Recovery path 2: the enroll CTA targets the add-profile enrollment.
    expect(screen.getByRole('link', { name: 'Start a new family' })).toHaveAttribute(
      'href',
      '/enroll/parent',
    );
    // None of the normal dashboard surfaces render underneath.
    expect(screen.queryByText('Nothing booked yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /find a tutor/i })).not.toBeInTheDocument();
  });

  it('a MEMBERED parent (profile familyId) never sees the family-less state', async () => {
    renderWithProviders(<DashboardPage />); // reset() doc carries familyId fam1
    expect(screen.queryByText('You are not currently part of a family')).not.toBeInTheDocument();
    expect(await screen.findByText('Nothing booked yet')).toBeInTheDocument();
  });

  it('a LEGACY Plan C doc (root familyId only) is a member, and its family is QUERIED', async () => {
    // Reading only profiles.parent.familyId let a Plan C parent past the
    // membership guard and then straight into an affirmative "Nothing booked
    // yet" — a claim that could be flatly false, with no search button either
    // (PR #345 round 2). hasFamilyMembership accepts the root field, so the
    // page must resolve it the same way: the client guards match the server
    // 1:1 or they are not guards.
    h.auth.userDoc = {
      uid: 'p1',
      firstName: 'Dana',
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true } },
    };
    h.familyData = { familyName: 'Legacy', verification: { isFullyVerified: true } };
    h.requests = [request({ requestId: 'r1', tutorName: 'Sarah' })];
    renderWithProviders(<DashboardPage />);

    expect(screen.queryByText('You are not currently part of a family')).not.toBeInTheDocument();
    // The row loads, so the empty state is never claimed...
    expect(await screen.findByText('Sarah')).toBeInTheDocument();
    expect(screen.queryByText('Nothing booked yet')).not.toBeInTheDocument();
    // ...the queries used the ROOT familyId...
    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam-legacy');
    // ...and the verification gate resolved, so search is reachable.
    expect(screen.getByRole('button', { name: /find a tutor/i })).toBeInTheDocument();
  });
});
