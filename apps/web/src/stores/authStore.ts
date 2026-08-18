import { create } from 'zustand';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@/config/firebase';
import { removePushToken } from '@/lib/pushNotifications';
import { loginErrorKey } from '@ejm/shared-core';
import type { SitUser } from '@ejm/sit-core';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  userDoc: SitUser | null;
  loading: boolean;
  error: string | null;
  /**
   * Set when the session was force-signed-out because users/{uid}.sessionEpoch
   * advanced (a signOutEverywhere from this or the other app). The
   * ForcedSignOutWatcher consumes it: toast + land on '/'.
   */
  forcedSignOut: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshUserDoc: () => Promise<void>;
  clearError: () => void;
  acknowledgeForcedSignOut: () => void;
}

/**
 * Cross-app session coherence (issue #181).
 *
 * The epoch captured at sign-in lives in module state AND per-origin
 * localStorage keyed by uid, so a reload re-arms from storage: a bump that
 * happened while the tab was closed still signs the restored session out
 * immediately (the server-side refresh-token revocation is the slower
 * backstop). A FRESH sign-in (login page, handoff, post-enroll) re-captures
 * from the doc instead — otherwise a stale stored epoch from a previous
 * session of the same uid would force-sign-out a brand-new login.
 */
const SESSION_EPOCH_KEY = 'sessionEpoch:';

/** Epoch of a user doc in millis; legacy docs without the field are 0. */
function epochMillisOf(data: SitUser | null): number {
  return data?.sessionEpoch ? data.sessionEpoch.toDate().getTime() : 0;
}

function readStoredEpoch(uid: string): number | null {
  try {
    const raw = localStorage.getItem(SESSION_EPOCH_KEY + uid);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredEpoch(uid: string, millis: number): void {
  try {
    localStorage.setItem(SESSION_EPOCH_KEY + uid, String(millis));
  } catch {
    // Storage unavailable (private mode): the in-memory capture still works
    // for this tab; the token-revocation backstop covers reloads.
  }
}

function clearStoredEpoch(uid: string): void {
  try {
    localStorage.removeItem(SESSION_EPOCH_KEY + uid);
  } catch {
    // ignore
  }
}

/**
 * One-shot flag: the NEXT auth-state change is a fresh, deliberate sign-in
 * (login page, cross-app handoff, post-enroll auto-login), so the epoch must
 * be (re-)captured from the doc, never re-armed from stale storage. Exported
 * for the sign-in paths that bypass the store (handoff, enrollment wizards).
 */
let nextSignInIsFresh = false;
export function markNextSignInFresh(): void {
  nextSignInIsFresh = true;
}

let userDocUnsub: (() => void) | null = null;
let watchedUid: string | null = null;
let capturedEpochMs = 0;

function detachUserDocListener(): void {
  if (userDocUnsub) {
    userDocUnsub();
    userDocUnsub = null;
  }
  watchedUid = null;
}

/** Capture (overwrite) the armed epoch for a fresh sign-in of `uid`. */
function captureEpoch(uid: string, millis: number): void {
  capturedEpochMs = millis;
  writeStoredEpoch(uid, millis);
}

/** The doc's epoch is newer than the one this session captured: sign out. */
async function forceLocalSignOut(uid: string): Promise<void> {
  detachUserDocListener();
  clearStoredEpoch(uid);
  try {
    await signOut(auth);
  } catch {
    // Even if the SDK sign-out throws, clear local state below.
  }
  useAuthStore.setState({
    firebaseUser: null,
    userDoc: null,
    loading: false,
    forcedSignOut: true,
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  firebaseUser: null,
  userDoc: null,
  loading: true,
  error: null,
  forcedSignOut: false,

  login: async (email: string, password: string) => {
    try {
      set({ loading: true, error: null });
      markNextSignInFresh();
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Fetch userDoc immediately so state is ready when login() returns
      // (don't rely solely on onAuthStateChanged which may resolve after redirect)
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      const userDoc = snap.exists() ? (snap.data() as SitUser) : null;
      // Ordinary (re-)login: re-capture the epoch — this session is the
      // freshest intent, whatever an earlier session left in storage.
      captureEpoch(cred.user.uid, epochMillisOf(userDoc));
      set({ firebaseUser: cred.user, userDoc, loading: false });
    } catch (err: unknown) {
      nextSignInIsFresh = false;
      // i18n key, not a raw message: raw firebase errors reveal whether an
      // account exists for the attempted email (issue #147).
      set({ error: loginErrorKey(err), loading: false });
      throw err;
    }
  },

  logout: async () => {
    const uid = get().firebaseUser?.uid ?? null;
    // Detach BEFORE bumping the epoch: our own signOutEverywhere must not
    // race the doc watcher into the forced-sign-out (toast) path.
    detachUserDocListener();
    if (uid) {
      await removePushToken(uid).catch(() => {});
    }
    // Logout means logout EVERYWHERE (issue #181) — best-effort: offline or
    // failing, the user still signs out locally (never trap them); the
    // server-side token revocation is the backstop anyway.
    try {
      await httpsCallable(functions, 'signOutEverywhere')();
    } catch (err) {
      console.warn('signOutEverywhere failed; signing out locally only', err);
    }
    if (uid) clearStoredEpoch(uid);
    await signOut(auth);
    set({ firebaseUser: null, userDoc: null });
  },

  resetPassword: async (email: string) => {
    try {
      set({ error: null });
      await sendPasswordResetEmail(auth, email);
    } catch (err: unknown) {
      set({ error: 'auth.errorResetFailed' });
      throw err;
    }
  },

  refreshUserDoc: async () => {
    const { firebaseUser } = get();
    if (!firebaseUser) return;
    const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
    if (snap.exists()) {
      set({ userDoc: snap.data() as SitUser });
    }
  },

  clearError: () => set({ error: null }),

  acknowledgeForcedSignOut: () => set({ forcedSignOut: false }),
}));

// Listen for auth state changes and watch the user doc while signed in.
// The realtime listener replaces the old one-shot getDoc: the FIRST snapshot
// fulfills the "userDoc set once auth resolves" contract (loading -> false),
// and every snapshot checks the session epoch (issue #181).
onAuthStateChanged(auth, (firebaseUser) => {
  if (!firebaseUser) {
    detachUserDocListener();
    useAuthStore.setState({
      firebaseUser: null,
      userDoc: null,
      loading: false,
    });
    return;
  }

  const uid = firebaseUser.uid;
  if (watchedUid === uid && userDocUnsub) {
    // Duplicate event for the user already being watched — keep the armed
    // epoch and the live listener.
    useAuthStore.setState({ firebaseUser });
    return;
  }

  detachUserDocListener();
  const fresh = nextSignInIsFresh;
  nextSignInIsFresh = false;
  watchedUid = uid;
  let firstSnapshot = true;
  userDocUnsub = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      const userDoc = snap.exists() ? (snap.data() as SitUser) : null;
      const docEpoch = epochMillisOf(userDoc);
      if (firstSnapshot) {
        firstSnapshot = false;
        // Fresh sign-in: capture the doc's epoch. Restored session (reload):
        // re-arm from storage so a bump made while the tab was closed still
        // fires; legacy sessions with nothing stored capture the doc's epoch.
        const stored = fresh ? null : readStoredEpoch(uid);
        captureEpoch(uid, stored ?? docEpoch);
      }
      if (docEpoch > capturedEpochMs) {
        void forceLocalSignOut(uid);
        return;
      }
      useAuthStore.setState({ firebaseUser, userDoc, loading: false });
    },
    () => {
      // Mirror the old getDoc catch: authenticated, but no readable doc.
      useAuthStore.setState({ firebaseUser, userDoc: null, loading: false });
    },
  );
});
