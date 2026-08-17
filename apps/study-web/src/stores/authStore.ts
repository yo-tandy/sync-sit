import { create } from 'zustand';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { loginErrorKey } from '@ejm/shared-core';
import type { StudyUser } from '@ejm/study-core';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  userDoc: StudyUser | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshUserDoc: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  firebaseUser: null,
  userDoc: null,
  loading: true,
  error: null,

  login: async (email: string, password: string) => {
    try {
      set({ loading: true, error: null });
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      const userDoc = snap.exists() ? (snap.data() as StudyUser) : null;
      set({ firebaseUser: cred.user, userDoc, loading: false });
    } catch (err: unknown) {
      // i18n key, not a raw message: raw firebase errors reveal whether an
      // account exists for the attempted email (issue #147).
      set({ error: loginErrorKey(err), loading: false });
      throw err;
    }
  },

  logout: async () => {
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
      set({ userDoc: snap.data() as StudyUser });
    }
  },

  clearError: () => set({ error: null }),
}));

// Listen for auth state changes and load user doc
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    try {
      const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
      const userDoc = snap.exists() ? (snap.data() as StudyUser) : null;
      useAuthStore.setState({ firebaseUser, userDoc, loading: false });
    } catch {
      useAuthStore.setState({ firebaseUser, userDoc: null, loading: false });
    }
  } else {
    useAuthStore.setState({ firebaseUser: null, userDoc: null, loading: false });
  }
});
