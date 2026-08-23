import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act } from '@testing-library/react';
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
  // studyContactRequests docs for the pending/accepted counts.
  requests: [] as Record<string, unknown>[],
  // study-sessions docs for the sessions pending/upcoming counts.
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
 * reads, so the Today/Tomorrow pins hold in any test-runner timezone. */
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
    familyId: 'fam1',
    status: 'confirmed',
    type: 'one_time',
    date: '2099-01-01',
    startTime: '17:00',
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

  it('shows the verification banner when the family is not fully verified', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: false } };
    renderWithProviders(<DashboardPage />);
    // Banner explains search is locked and opens the IN-APP verification page
    // (issue #129: the flow is shared with sit but lives in the current app).
    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /complete verification/i })).toHaveAttribute(
      'href',
      '/family/verification',
    );
    // No active search CTA while unverified.
    expect(screen.queryByRole('link', { name: /find a tutor/i })).not.toBeInTheDocument();
  });

  it('treats an absent verification field as not verified (banner shown)', async () => {
    h.familyData = { familyName: 'Cohen' }; // no verification => not verified
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
  });

  it('shows the find-a-tutor CTA (and hides the banner) when fully verified', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    renderWithProviders(<DashboardPage />);
    const cta = await screen.findByRole('link', { name: /find a tutor/i });
    expect(cta).toHaveAttribute('href', '/family/search');
    expect(screen.queryByText(/verify your family/i)).not.toBeInTheDocument();
  });

  it('renders live pending/accepted request counts linking to the requests page', async () => {
    h.requests = [
      { requestId: 'r1', familyId: 'fam1', status: 'pending' },
      { requestId: 'r2', familyId: 'fam1', status: 'pending' },
      { requestId: 'r3', familyId: 'fam1', status: 'accepted' },
      { requestId: 'r4', familyId: 'fam1', status: 'declined' },
    ];
    renderWithProviders(<DashboardPage />);

    const link = await screen.findByRole('link', { name: /view your requests/i });
    expect(link).toHaveAttribute('href', '/family/requests');
    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
    // 2 pending, 1 accepted — inline on the compact tile.
    expect(await screen.findByText('2 pending · 1 accepted')).toBeInTheDocument();
  });

  it('counts a TUTOR-initiated pending apart, and says the family is the one to answer', async () => {
    // "You have 1 pending request / Tutors usually reply within a day or two"
    // is backwards on both halves for a request a tutor sent us
    // (issue #207 PR4, PR #213 review).
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.requests = [
      { requestId: 'r1', familyId: 'fam1', status: 'pending', initiatedBy: 'tutor' },
      { requestId: 'r2', familyId: 'fam1', status: 'pending' },
    ];
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/answered your published search/i)).toBeInTheDocument();
    expect(screen.queryByText(/tutors usually reply/i)).not.toBeInTheDocument();
    // The tile keeps them apart too: one to answer, one still waiting on a tutor.
    expect(await screen.findByText('1 to answer · 1 pending · 0 accepted')).toBeInTheDocument();
  });

  it('shows the empty requests message when the family has none', async () => {
    h.requests = [];
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
  });

  it('does not flash the no-requests message while counts are still loading', () => {
    // getDocs never resolves → counts stay null → no empty message yet.
    h.getDocs.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<DashboardPage />);
    expect(screen.queryByText(/no requests yet/i)).not.toBeInTheDocument();
  });

  it('renders a sessions card with pending/upcoming counts linking to /family/sessions', async () => {
    h.sessions = [
      { sessionId: 's1', familyId: 'fam1', status: 'pending' },
      { sessionId: 's2', familyId: 'fam1', status: 'confirmed' },
      { sessionId: 's3', familyId: 'fam1', status: 'confirmed' },
      { sessionId: 's4', familyId: 'fam1', status: 'completed' },
    ];
    renderWithProviders(<DashboardPage />);

    const link = await screen.findByRole('link', { name: /your sessions/i });
    expect(link).toHaveAttribute('href', '/family/sessions');
    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
    // 1 pending, 2 upcoming (confirmed) — inline on the compact tile.
    expect(await screen.findByText('1 pending · 2 upcoming')).toBeInTheDocument();
  });

  it('a refetch blip keeps last-known-good: verified banner and counts survive failed reads', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.requests = [{ status: 'pending' }, { status: 'pending' }, { status: 'accepted' }];
    h.sessions = [{ status: 'pending' }, { status: 'confirmed', date: '2099-01-01' }];
    renderWithProviders(<DashboardPage />);

    // Initial load: verified (search stays reachable — as the tile, since the
    // 2099 session claims the hero) + real counts inline on the tiles.
    expect(await screen.findByRole('link', { name: /find a tutor/i })).toBeInTheDocument();
    expect(await screen.findByText('2 pending · 1 accepted')).toBeInTheDocument();
    expect(await screen.findByText('1 pending · 1 upcoming')).toBeInTheDocument();

    // Network blip: every read now fails; the user returns to the tab.
    h.getDoc.mockImplementation(() => Promise.reject(new Error('unavailable')));
    h.getDocs.mockImplementation(() => Promise.reject(new Error('unavailable')));
    await act(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 20_000));
      window.dispatchEvent(new Event('focus'));
      vi.useRealTimers();
    });

    // Still verified, counts intact — no un-verify banner, nothing zeroed:
    // both tiles keep their last-known-good count lines (zeroing sessionData
    // would collapse the sessions tile to its empty line).
    expect(screen.getByRole('link', { name: /find a tutor/i })).toBeInTheDocument();
    expect(screen.getByText('2 pending · 1 accepted')).toBeInTheDocument();
    expect(screen.getByText('1 pending · 1 upcoming')).toBeInTheDocument();
    expect(screen.queryByText(/not.*verified|verify/i)).not.toBeInTheDocument();
  });

  it('renders a governance entry card linking to /family/governance', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('link', { name: /supervised kids/i })).toHaveAttribute(
      'href',
      '/family/governance',
    );
  });

  it('renders entry cards linking to settings and account', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('link', { name: /family settings/i })).toHaveAttribute(
      'href',
      '/family/settings',
    );
    // Anchored: the governance card's description also contains "accounts".
    expect(screen.getByRole('link', { name: /^account\b/i })).toHaveAttribute(
      'href',
      '/family/account',
    );
  });

  // ── Hero priority (issue #120): first match wins ──

  it('hero: a confirmed future session wins and links to /family/sessions', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.requests = [{ requestId: 'r1', familyId: 'fam1', status: 'accepted' }];
    h.sessions = [
      {
        sessionId: 's1',
        familyId: 'fam1',
        status: 'confirmed',
        type: 'one_time',
        date: '2099-01-02',
        startTime: '18:00',
        tutorName: 'Sarah',
      },
      {
        sessionId: 's2',
        familyId: 'fam1',
        status: 'confirmed',
        type: 'one_time',
        date: '2099-01-01',
        startTime: '17:00',
        tutorName: 'Leo',
      },
    ];
    renderWithProviders(<DashboardPage />);

    const hero = await screen.findByRole('link', { name: /next session/i });
    expect(hero).toHaveAttribute('href', '/family/sessions');
    // The soonest session's details, not the later one's.
    expect(screen.getByText(/17:00/)).toBeInTheDocument();
    expect(screen.getByText(/Leo/)).toBeInTheDocument();
    // The accepted-request hero lost the priority race.
    expect(screen.queryByText(/accepted your request/i)).not.toBeInTheDocument();
  });

  it('hero: no session but an accepted request → accepted hero to /family/requests', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.requests = [
      { requestId: 'r1', familyId: 'fam1', status: 'accepted' },
      { requestId: 'r2', familyId: 'fam1', status: 'pending' },
    ];
    renderWithProviders(<DashboardPage />);

    const hero = await screen.findByRole('link', { name: /accepted your request/i });
    expect(hero).toHaveAttribute('href', '/family/requests');
    // Accepted beats pending: no pending-hero title anywhere.
    expect(screen.queryByText(/you have 1 pending request/i)).not.toBeInTheDocument();
  });

  it('hero: only pending requests → pending hero to /family/requests', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.requests = [
      { requestId: 'r1', familyId: 'fam1', status: 'pending' },
      { requestId: 'r2', familyId: 'fam1', status: 'pending' },
    ];
    renderWithProviders(<DashboardPage />);

    const hero = await screen.findByRole('link', { name: /you have 2 pending requests/i });
    expect(hero).toHaveAttribute('href', '/family/requests');
  });

  it('hero: all zero + verified → the search CTA is the hero, not duplicated as a tile', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    renderWithProviders(<DashboardPage />);

    const searchLinks = await screen.findAllByRole('link', { name: /find a tutor/i });
    expect(searchLinks).toHaveLength(1);
    expect(searchLinks[0]).toHaveAttribute('href', '/family/search');
  });

  it('hero: says Today (not a day count) for a session later today', async () => {
    // Frozen clock: a wall-clock fixture ("today at 23:59") has a genuine
    // one-minute-a-day flake window at 23:59 Paris. 11:00Z in March is 12:00
    // Paris (UTC+1), so 18:00 the same day is unconditionally in the future.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2027-03-05T11:00:00Z'));
    try {
      h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
      h.sessions = [
        session({ sessionId: 's1', date: '2027-03-05', startTime: '18:00', tutorName: 'Leo' }),
      ];
      renderWithProviders(<DashboardPage />);
      expect(await screen.findByText(/today/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hero: says Tomorrow (not a day count) for a session tomorrow', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.sessions = [
      session({ sessionId: 's2', date: parisDatePlus(1), startTime: '09:00', tutorName: 'Leo' }),
    ];
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/tomorrow/i)).toBeInTheDocument();
  });

  it('hero: a recurring series never claims the hero but still counts as upcoming', async () => {
    // The headline design call of this page: recurring dates live in the
    // instances subcollection this page must not query, so the hero skips
    // recurring docs and falls through to the next priority.
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.requests = [{ requestId: 'r1', familyId: 'fam1', status: 'accepted' }];
    h.sessions = [
      session({ sessionId: 's1', type: 'recurring', date: '2099-01-01', tutorName: 'Sarah' }),
    ];
    renderWithProviders(<DashboardPage />);

    const hero = await screen.findByRole('link', { name: /accepted your request/i });
    expect(hero).toHaveAttribute('href', '/family/requests');
    expect(screen.queryByText(/next session/i)).not.toBeInTheDocument();
    // ...while the sessions tile still counts the series as upcoming.
    expect(screen.getByText(/1 upcoming/i)).toBeInTheDocument();
  });

  it('hero: a confirmed session that already started today does not claim the hero', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.sessions = [
      // 00:00 today: `${date}T00:00 > now` is false from midnight onward.
      session({ sessionId: 's1', date: parisDatePlus(0), startTime: '00:00', tutorName: 'Leo' }),
      session({ sessionId: 's2', date: '2001-01-01', startTime: '10:00', tutorName: 'Mia' }),
    ];
    renderWithProviders(<DashboardPage />);

    // Falls through to the search hero — nothing upcoming to announce.
    const searchLinks = await screen.findAllByRole('link', { name: /find a tutor/i });
    expect(searchLinks).toHaveLength(1);
    expect(screen.queryByText(/next session/i)).not.toBeInTheDocument();
  });

  it('a failed requests read never makes search unreachable for a verified family', async () => {
    // The app bar has no /family/search item — this page is the only way in.
    // A failed read is unknown, not zero: counts stays null forever, so the
    // search fallback must not sit behind the snapshot guard.
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    h.getDocs.mockImplementation((q: { query?: { path: string }[] }) => {
      const path = q?.query?.[0]?.path ?? '';
      if (path === 'studyContactRequests') return Promise.reject(new Error('offline'));
      return Promise.resolve({ docs: [] });
    });
    renderWithProviders(<DashboardPage />);

    const searchLinks = await screen.findAllByRole('link', { name: /find a tutor/i });
    expect(searchLinks).toHaveLength(1);
    expect(searchLinks[0]).toHaveAttribute('href', '/family/search');
  });

  it('hero: unverified with nothing actionable → no hero, the banner leads', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: false } };
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {
        name: /find a tutor|next session|pending request|accepted/i,
      }),
    ).not.toBeInTheDocument();
  });
});
