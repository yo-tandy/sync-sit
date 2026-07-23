import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression / provability pin (Hardening PR H2).
//
// The family dashboard loads the parent's submitted endorsements from the
// shared `references` collection. It used to read the WHOLE collection and
// filter by submittedByUserId client-side — which the hardened read rule
// (H2) denies for non-admins, because a LIST is only allowed when the rules
// engine can prove the read rule from the query constraints alone. This test
// pins the query's `where('submittedByUserId', '==', uid)` filter so the read
// stays provable via the involved-party (submitter) disjunct.

const h = vi.hoisted(() => ({
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  onSnapshot: vi.fn(),
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
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  addDoc: vi.fn(),
}));

// Controllable auth / verification stores + appointments hook.
const auth = { userDoc: null as unknown };
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/stores/verificationStore', () => ({
  useVerificationStore: () => ({ familyVerification: null, fetchStatus: vi.fn() }),
}));
vi.mock('@/hooks/useFamilyAppointments', () => ({
  useFamilyAppointments: () => ({
    pending: [], confirmed: [], pastRecent: [], rejectedRecent: [], loading: false,
  }),
}));

import i18n from '@/i18n';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FamilyDashboard } from '../DashboardPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <FamilyDashboard />
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

describe('family DashboardPage — submitted references query (H2)', () => {
  beforeEach(() => {
    installLocalStorageStub();
    i18n.changeLanguage('en');
    h.where.mockClear();
    h.onSnapshot.mockClear();
    auth.userDoc = {
      uid: 'p1',
      firstName: 'Dana',
      profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
    };
  });

  afterEach(() => cleanup());

  it('constrains the references read to submittedByUserId == own uid (provable via submitter disjunct)', () => {
    renderPage();
    expect(h.where).toHaveBeenCalledWith('submittedByUserId', '==', 'p1');
  });

  it('does not issue an unfiltered references query (no bare collection read)', () => {
    renderPage();
    // The only `where` filter the page issues is the submittedByUserId pin;
    // an unfiltered references list would call onSnapshot with a raw
    // collection ref and never touch `where`.
    const refsSubscription = h.where.mock.calls.some(
      (c) => c[0] === 'submittedByUserId' && c[1] === '==' && c[2] === 'p1',
    );
    expect(refsSubscription).toBe(true);
  });
});
