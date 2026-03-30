import { create } from 'zustand';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import type { UserDoc } from '@ejm/shared';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  userDoc: UserDoc | null;
  loading: boolean;
  error: string | null;

  // Actions
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
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      set({ error: err.message, loading: false });
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
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  refreshUserDoc: async () => {
    const { firebaseUser } = get();
    if (!firebaseUser) return;
    const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
    if (snap.exists()) {
      set({ userDoc: snap.data() as UserDoc });
    }
  },

  clearError: () => set({ error: null }),
}));

// Listen for auth state changes and load user doc
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    try {
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const snap = await getDoc(userDocRef);
      const userDoc = snap.exists() ? (snap.data() as UserDoc) : null;
      useAuthStore.setState({ firebaseUser, userDoc, loading: false });
    } catch {
      useAuthStore.setState({ firebaseUser, userDoc: null, loading: false });
    }
  } else {
    useAuthStore.setState({
      firebaseUser: null,
      userDoc: null,
      loading: false,
    });
  }
});
