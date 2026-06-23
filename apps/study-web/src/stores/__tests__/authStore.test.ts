import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { getDoc } from 'firebase/firestore';

vi.mock('@/config/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(),
}));

// Imported after mocks are registered (vi.mock is hoisted).
import { useAuthStore } from '../authStore';

const mSignIn = vi.mocked(signInWithEmailAndPassword);
const mSignOut = vi.mocked(signOut);
const mReset = vi.mocked(sendPasswordResetEmail);
const mGetDoc = vi.mocked(getDoc);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ firebaseUser: null, userDoc: null, loading: false, error: null });
});

describe('study authStore', () => {
  it('login fetches the user doc and populates state', async () => {
    mSignIn.mockResolvedValue({ user: { uid: 'u1' } } as never);
    mGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ uid: 'u1', profiles: { tutor: {} } }) } as never);

    await useAuthStore.getState().login('t@ejm.org', 'pw');

    expect(mSignIn).toHaveBeenCalledWith({}, 't@ejm.org', 'pw');
    expect(useAuthStore.getState().userDoc).toMatchObject({ uid: 'u1' });
    expect(useAuthStore.getState().loading).toBe(false);
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('login sets error and rethrows on failure', async () => {
    mSignIn.mockRejectedValue(new Error('bad creds'));
    await expect(useAuthStore.getState().login('t@ejm.org', 'wrong')).rejects.toThrow('bad creds');
    expect(useAuthStore.getState().error).toBe('bad creds');
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('logout signs out and clears the user', async () => {
    useAuthStore.setState({ firebaseUser: { uid: 'u1' } as never, userDoc: { uid: 'u1' } as never });
    await useAuthStore.getState().logout();
    expect(mSignOut).toHaveBeenCalled();
    expect(useAuthStore.getState().userDoc).toBeNull();
    expect(useAuthStore.getState().firebaseUser).toBeNull();
  });

  it('resetPassword calls sendPasswordResetEmail', async () => {
    await useAuthStore.getState().resetPassword('t@ejm.org');
    expect(mReset).toHaveBeenCalledWith({}, 't@ejm.org');
  });

  it('resetPassword sets error and rethrows on failure', async () => {
    mReset.mockRejectedValueOnce(new Error('no user'));
    await expect(useAuthStore.getState().resetPassword('x@ejm.org')).rejects.toThrow('no user');
    expect(useAuthStore.getState().error).toBe('no user');
  });

  it('clearError resets the error', () => {
    useAuthStore.setState({ error: 'boom' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});
