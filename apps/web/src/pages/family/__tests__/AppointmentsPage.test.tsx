import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Dedicated family appointments page (issue #241, parity Q1 = b).
//
// The page took over the dashboard's inline appointment surfaces wholesale:
// the four state sections (pending / confirmed / past / declined), the
// submitted-references subscription (H2 provability pin moved here with it),
// and the reference-prompt banner. These tests pin:
//   1. the H2 references query constraint (submittedByUserId == own uid),
//   2. that each populated bucket renders its section with its cards,
//   3. the empty state (with the search CTA) when every bucket is empty.

const h = vi.hoisted(() => ({
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  onSnapshot: vi.fn(),
  getDoc: vi.fn(),
  // Controllable appointments hook (the page's live data source).
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
  where: (...args: [string, string, unknown]) => h.where(...args),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  // The two page-level onSnapshot subscriptions (references list + families
  // doc): invoke the callback with an empty snapshot that satisfies both the
  // collection shape (`.docs`) and the doc shape (`.data()`), and hand back an
  // unsub.
  onSnapshot: (_ref: unknown, cb: (snap: unknown) => void) => {
    h.onSnapshot(_ref);
    cb({ docs: [], data: () => ({}) });
    return () => {};
  },
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

const auth = { userDoc: null as unknown };
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/hooks/useFamilyAppointments', () => ({
  useFamilyAppointments: () => h.apts,
}));

// The card component has its own data needs (holidays, reference lookups);
// stub it so these tests pin the PAGE's sectioning, not the card internals.
vi.mock('@/components/appointments/ExpandableBabysitterCard', () => ({
  ExpandableBabysitterCard: ({ appointment, variant }: { appointment: { appointmentId: string }; variant: string }) => (
    <div data-testid={`card-${appointment.appointmentId}`}>{variant}</div>
  ),
}));

import i18n from '@/i18n';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FamilyAppointmentsPage } from '../AppointmentsPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/family/appointments']}>
      <FamilyAppointmentsPage />
    </MemoryRouter>,
  );
}

// The page reads localStorage at mount (ref-prompt dismissal). jsdom in this
// config doesn't expose one, so provide a minimal in-memory stub.
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
  h.where.mockClear();
  h.onSnapshot.mockClear();
  h.getDoc.mockReset();
  h.getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
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

describe('family AppointmentsPage — submitted references query (H2, moved from the dashboard)', () => {
  it('constrains the references read to submittedByUserId == own uid (provable via submitter disjunct)', () => {
    renderPage();
    expect(h.where).toHaveBeenCalledWith('submittedByUserId', '==', 'p1');
  });
});

describe('family AppointmentsPage — sections (issue #241)', () => {
  it('renders all four sections with their appointment cards', () => {
    h.apts.pending = [apt('a1', 'pending')];
    h.apts.confirmed = [apt('a2', 'confirmed')];
    h.apts.pastRecent = [apt('a3', 'confirmed', { date: '2026-08-01' })];
    h.apts.rejectedRecent = [apt('a4', 'rejected')];
    renderPage();

    expect(screen.getByText('Pending Requests')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('Past')).toBeTruthy();
    expect(screen.getByText('Declined')).toBeTruthy();

    expect(screen.getByTestId('card-a1').textContent).toBe('pending');
    expect(screen.getByTestId('card-a2').textContent).toBe('confirmed');
    expect(screen.getByTestId('card-a3').textContent).toBe('past');
    expect(screen.getByTestId('card-a4').textContent).toBe('rejected');
  });

  it('groups pending requests under a date · time label', () => {
    h.apts.pending = [apt('a1', 'pending')];
    renderPage();
    // 2026-09-01 is a Tuesday; en-GB short format.
    expect(screen.getByText(/Tue.*Sep.*·.*18:00–21:00/)).toBeTruthy();
  });

  it('renders only the populated sections', () => {
    h.apts.confirmed = [apt('a2', 'confirmed')];
    renderPage();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.queryByText('Pending Requests')).toBeNull();
    expect(screen.queryByText('Past')).toBeNull();
    expect(screen.queryByText('Declined')).toBeNull();
  });

  it('shows the empty state with a search CTA when there are no appointments at all', () => {
    renderPage();
    expect(screen.getByText('No appointments yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Find a Babysitter/i })).toBeTruthy();
  });
});
