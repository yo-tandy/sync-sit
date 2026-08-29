import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

// The sessionEpoch suite ported from study-web (the PR #310 review
// carry-forward, recorded on #296: land it once profiles.doer exists).
// do-web has push as of plan §13 PR9, so study's two logout push-token pins
// are ported alongside it (PR #334 review).
const h = vi.hoisted(() => ({
  authCb: null as ((user: unknown) => void) | null,
  signOutEverywhere: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  removePushToken: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {} }));
vi.mock('@/lib/pushNotifications', () => ({
  removePushToken: h.removePushToken,
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: unknown) => void) => {
    h.authCb = cb;
    return () => {};
  }),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => h.signOutEverywhere),
}));

// Imported after mocks are registered (vi.mock is hoisted).
import { useAuthStore, markNextSignInFresh } from '../authStore';

const mSignIn = vi.mocked(signInWithEmailAndPassword);
const mSignOut = vi.mocked(signOut);
const mReset = vi.mocked(sendPasswordResetEmail);
const mGetDoc = vi.mocked(getDoc);
const mOnSnapshot = vi.mocked(onSnapshot);
const mHttpsCallable = vi.mocked(httpsCallable);

/** A Firestore-Timestamp-shaped session epoch. */
const ts = (millis: number) => ({
  seconds: Math.floor(millis / 1000),
  nanoseconds: 0,
  toDate: () => new Date(millis),
});

const snapOf = (data: Record<string, unknown> | null, fromCache = false) => ({
  exists: () => data !== null,
  data: () => data,
  metadata: { fromCache },
});

/** Attach the user-doc watcher via the captured onAuthStateChanged callback. */
function emitAuth(user: { uid: string } | null): {
  emitSnap: (data: Record<string, unknown> | null, fromCache?: boolean) => void;
  unsub: ReturnType<typeof vi.fn>;
} {
  const unsub = vi.fn();
  let next: ((snap: unknown) => void) | null = null;
  mOnSnapshot.mockImplementationOnce(((_ref: unknown, onNext: (snap: unknown) => void) => {
    next = onNext;
    return unsub;
  }) as never);
  h.authCb!(user);
  return {
    emitSnap: (data, fromCache = false) => next!(snapOf(data, fromCache)),
    unsub,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// jsdom in this config doesn't expose localStorage — minimal in-memory stub
// (same idiom as study-web's copy of this suite).
function installLocalStorageStub() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
}
installLocalStorageStub();

beforeEach(() => {
  vi.clearAllMocks();
  h.signOutEverywhere.mockResolvedValue({ data: { ok: true } });
  h.removePushToken.mockResolvedValue();
  mSignOut.mockResolvedValue();
  // Drain any pending fresh-sign-in mark a login test left behind, so each
  // test starts with deterministic module state (flag consumed, no watcher,
  // per-uid armed epoch reset to the throwaway 'drain' uid at 0).
  mOnSnapshot.mockImplementationOnce(((_ref: unknown, onNext: (snap: unknown) => void) => {
    onNext(snapOf({ uid: 'drain' }));
    return () => {};
  }) as never);
  h.authCb?.({ uid: 'drain' });
  h.authCb?.(null);
  localStorage.clear();
  useAuthStore.setState({
    firebaseUser: null,
    userDoc: null,
    loading: false,
    error: null,
    forcedSignOut: false,
  });
});

afterEach(() => {
  // Detach any live doc watcher + reset the module's watched-uid state.
  h.authCb?.(null);
  localStorage.clear();
});

describe('do authStore', () => {
  it('login fetches the user doc and populates state', async () => {
    mSignIn.mockResolvedValue({ user: { uid: 'u1' } } as never);
    mGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ uid: 'u1', profiles: { doer: {} } }) } as never);

    await useAuthStore.getState().login('d@ejm.org', 'pw');

    expect(mSignIn).toHaveBeenCalledWith({}, 'd@ejm.org', 'pw');
    expect(useAuthStore.getState().userDoc).toMatchObject({ uid: 'u1' });
    expect(useAuthStore.getState().loading).toBe(false);
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('login sets a generic i18n error key and rethrows on failure (issue #147)', async () => {
    mSignIn.mockRejectedValue(new Error('bad creds'));
    await expect(useAuthStore.getState().login('d@ejm.org', 'wrong')).rejects.toThrow('bad creds');
    // Never the raw message: it can reveal whether the account exists.
    expect(useAuthStore.getState().error).toBe('auth.errorLoginFailed');
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('login collapses credential failures into the invalid-credentials key (issue #147)', async () => {
    const err = Object.assign(new Error('Firebase: Error (auth/user-not-found).'), {
      code: 'auth/user-not-found',
    });
    mSignIn.mockRejectedValue(err);
    await expect(useAuthStore.getState().login('d@ejm.org', 'wrong')).rejects.toThrow();
    expect(useAuthStore.getState().error).toBe('auth.errorInvalidCredentials');
  });

  it('logout signs out and clears the user', async () => {
    useAuthStore.setState({ firebaseUser: { uid: 'u1' } as never, userDoc: { uid: 'u1' } as never });
    await useAuthStore.getState().logout();
    // The device's token is unregistered from fcmTokensDo for THIS uid —
    // otherwise the next sign-in on a shared device re-registers the same
    // token and this user's pushes land on the next user's screen (the
    // guarantee study pins in its twin; PR #334 review).
    expect(h.removePushToken).toHaveBeenCalledWith('u1');
    expect(mSignOut).toHaveBeenCalled();
    expect(useAuthStore.getState().userDoc).toBeNull();
    expect(useAuthStore.getState().firebaseUser).toBeNull();
  });

  it('resetPassword calls sendPasswordResetEmail', async () => {
    await useAuthStore.getState().resetPassword('d@ejm.org');
    expect(mReset).toHaveBeenCalledWith({}, 'd@ejm.org');
  });

  it('resetPassword sets a generic i18n error key and rethrows on failure', async () => {
    mReset.mockRejectedValueOnce(new Error('no user'));
    await expect(useAuthStore.getState().resetPassword('x@ejm.org')).rejects.toThrow('no user');
    expect(useAuthStore.getState().error).toBe('auth.errorResetFailed');
  });

  it('clearError resets the error', () => {
    useAuthStore.setState({ error: 'boom' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});

describe('do authStore — cross-app session coherence (issue #181)', () => {
  it('login captures the session epoch into per-uid localStorage', async () => {
    mSignIn.mockResolvedValue({ user: { uid: 'u1' } } as never);
    mGetDoc.mockResolvedValue(snapOf({ uid: 'u1', sessionEpoch: ts(5000) }) as never);

    await useAuthStore.getState().login('d@ejm.org', 'pw');

    expect(localStorage.getItem('sessionEpoch:u1')).toBe('5000');
  });

  it('login on a legacy doc (no sessionEpoch) captures epoch 0', async () => {
    mSignIn.mockResolvedValue({ user: { uid: 'u1' } } as never);
    mGetDoc.mockResolvedValue(snapOf({ uid: 'u1' }) as never);

    await useAuthStore.getState().login('d@ejm.org', 'pw');

    expect(localStorage.getItem('sessionEpoch:u1')).toBe('0');
  });

  it('first snapshot fulfills the userDoc contract (loading resolves)', () => {
    useAuthStore.setState({ loading: true });
    const { emitSnap } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1000) });

    const state = useAuthStore.getState();
    expect(state.userDoc).toMatchObject({ uid: 'u1' });
    expect(state.loading).toBe(false);
    expect(state.firebaseUser).toMatchObject({ uid: 'u1' });
  });

  it('a NEWER-epoch snapshot force-signs out: signOut, state cleared, toast flag set', async () => {
    localStorage.setItem('sessionEpoch:u1', '1000');
    const { emitSnap, unsub } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1000) });
    expect(useAuthStore.getState().userDoc).not.toBeNull();

    emitSnap({ uid: 'u1', sessionEpoch: ts(2000) });
    await flush();

    expect(mSignOut).toHaveBeenCalledTimes(1);
    expect(unsub).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.firebaseUser).toBeNull();
    expect(state.userDoc).toBeNull();
    expect(state.forcedSignOut).toBe(true);
    // The armed epoch is cleared so the next sign-in re-captures.
    expect(localStorage.getItem('sessionEpoch:u1')).toBeNull();
  });

  it('an EQUAL-epoch snapshot leaves the session untouched', async () => {
    localStorage.setItem('sessionEpoch:u1', '1000');
    const { emitSnap } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1000) });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1000) });
    await flush();

    expect(mSignOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().forcedSignOut).toBe(false);
    expect(useAuthStore.getState().userDoc).not.toBeNull();
  });

  it('legacy snapshots without sessionEpoch never force a sign-out', async () => {
    const { emitSnap } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1' });
    emitSnap({ uid: 'u1' });
    await flush();

    expect(mSignOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().forcedSignOut).toBe(false);
  });

  it('a reload re-arms from localStorage: a bump made while the tab was closed fires immediately', async () => {
    // Captured 500 in a previous session of this origin; the doc now says 1500.
    localStorage.setItem('sessionEpoch:u1', '500');
    const { emitSnap } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1500) });
    await flush();

    expect(mSignOut).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().forcedSignOut).toBe(true);
  });

  it('logout calls signOutEverywhere BEFORE the local sign-out', async () => {
    useAuthStore.setState({ firebaseUser: { uid: 'u1' } as never, userDoc: { uid: 'u1' } as never });
    await useAuthStore.getState().logout();

    expect(mHttpsCallable).toHaveBeenCalledWith({}, 'signOutEverywhere', { timeout: 5000 });
    expect(h.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(h.signOutEverywhere.mock.invocationCallOrder[0]).toBeLessThan(
      mSignOut.mock.invocationCallOrder[0],
    );
    expect(useAuthStore.getState().firebaseUser).toBeNull();
    // Self-initiated logout never raises the forced-sign-out toast.
    expect(useAuthStore.getState().forcedSignOut).toBe(false);
  });

  it('logout still signs out locally when the callable fails (never trap the user)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.signOutEverywhere.mockRejectedValueOnce(new Error('offline') as never);
    useAuthStore.setState({ firebaseUser: { uid: 'u1' } as never, userDoc: { uid: 'u1' } as never });

    await useAuthStore.getState().logout();

    expect(mSignOut).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().firebaseUser).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('logout detaches the doc watcher before bumping, so no self-toast races in', async () => {
    const { emitSnap, unsub } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1000) });

    await useAuthStore.getState().logout();

    expect(unsub).toHaveBeenCalled();
    expect(useAuthStore.getState().forcedSignOut).toBe(false);
    // The armed epoch for the uid is cleared on deliberate logout.
    expect(localStorage.getItem('sessionEpoch:u1')).toBeNull();
  });

  it('a stale cached first snapshot cannot lower the epoch armed at login (forward-only)', async () => {
    mSignIn.mockResolvedValue({ user: { uid: 'u1' } } as never);
    mGetDoc.mockResolvedValue(snapOf({ uid: 'u1', sessionEpoch: ts(2000) }) as never);
    await useAuthStore.getState().login('d@ejm.org', 'pw');
    expect(localStorage.getItem('sessionEpoch:u1')).toBe('2000');

    // The watcher attaches and its FIRST snapshot arrives from the SDK's
    // memory cache carrying the pre-logout epoch...
    const { emitSnap } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1000) });
    // ...the armed epoch must not move backward...
    expect(localStorage.getItem('sessionEpoch:u1')).toBe('2000');
    // ...so the follow-up server snapshot EQUAL to the armed epoch is a no-op.
    emitSnap({ uid: 'u1', sessionEpoch: ts(2000) });
    await flush();

    expect(mSignOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().forcedSignOut).toBe(false);
  });

  it('a cached pre-bump snapshot on a FRESH sign-in neither arms nor enforces (server-snapshot arming)', async () => {
    // The PR #184 review interleaving: same-page logout bumped the epoch to
    // 2000, the SDK cache still holds 1000, and the watcher's snapshots land
    // BEFORE login()'s own getDoc capture. Cached 1000 must not arm; the
    // server 2000 that follows must arm rather than force-sign-out.
    markNextSignInFresh();
    const { emitSnap } = emitAuth({ uid: 'u1' });
    emitSnap({ uid: 'u1', sessionEpoch: ts(1000) }, true);
    await flush();
    expect(mSignOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('sessionEpoch:u1')).toBeNull();

    emitSnap({ uid: 'u1', sessionEpoch: ts(2000) });
    await flush();
    expect(mSignOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().forcedSignOut).toBe(false);
    expect(localStorage.getItem('sessionEpoch:u1')).toBe('2000');

    emitSnap({ uid: 'u1', sessionEpoch: ts(3000) });
    await flush();
    expect(mSignOut).toHaveBeenCalled();
  });

  it('logout is bounded: hanging removePushToken AND callable still yield local sign-out', async () => {
    vi.useFakeTimers();
    try {
      // Both legs of logout hang. The bounds are the reason
      // PUSH_TOKEN_TIMEOUT_MS and raceWithTimeout exist: a regression here
      // traps a user on a stalled connection instead of merely losing a
      // token (PR #334 review, mirroring study's pin).
      h.removePushToken.mockImplementationOnce((() => new Promise(() => {})) as never);
      h.signOutEverywhere.mockImplementationOnce((() => new Promise(() => {})) as never);
      useAuthStore.setState({ firebaseUser: { uid: 'u1' } as never, userDoc: { uid: 'u1' } as never });

      const done = useAuthStore.getState().logout();
      // 3s push-token bound + 5s callable bound (mirrors sit's/study's pin).
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(5000);
      await done;

      expect(mSignOut).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().firebaseUser).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a different uid REPLACES the armed epoch (no cross-user carry-over)', async () => {
    // u1 arms a high epoch...
    mSignIn.mockResolvedValue({ user: { uid: 'u1' } } as never);
    mGetDoc.mockResolvedValue(snapOf({ uid: 'u1', sessionEpoch: ts(9000) }) as never);
    await useAuthStore.getState().login('a@x.com', 'pw');
    expect(localStorage.getItem('sessionEpoch:u1')).toBe('9000');

    // ...then u2 logs in with a LOWER epoch: forward-only is per uid, so the
    // capture REPLACES — u1's 9000 must not leak into u2's session.
    mSignIn.mockResolvedValue({ user: { uid: 'u2' } } as never);
    mGetDoc.mockResolvedValue(snapOf({ uid: 'u2', sessionEpoch: ts(100) }) as never);
    await useAuthStore.getState().login('b@x.com', 'pw');
    expect(localStorage.getItem('sessionEpoch:u2')).toBe('100');

    // u2's watcher: equal epoch is a no-op...
    const { emitSnap } = emitAuth({ uid: 'u2' });
    emitSnap({ uid: 'u2', sessionEpoch: ts(100) });
    await flush();
    expect(mSignOut).not.toHaveBeenCalled();
    // ...and a genuinely newer epoch still fires (a carried-over 9000 would
    // have swallowed it).
    emitSnap({ uid: 'u2', sessionEpoch: ts(200) });
    await flush();
    expect(mSignOut).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().forcedSignOut).toBe(true);
  });

  it('acknowledgeForcedSignOut clears the flag', () => {
    useAuthStore.setState({ forcedSignOut: true });
    useAuthStore.getState().acknowledgeForcedSignOut();
    expect(useAuthStore.getState().forcedSignOut).toBe(false);
  });
});
