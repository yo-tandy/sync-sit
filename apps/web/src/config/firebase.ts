import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';

// TODO: Replace with actual Firebase config after project creation
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-ejm-babysitter',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-ejm-babysitter.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'europe-west1');
export const storage = getStorage(app);

// Messaging — lazily initialized only when push permission is requested.
// Calling getMessaging() eagerly registers the service worker and triggers
// an Android system prompt ("wants to access other apps") before login.
export let messaging: ReturnType<typeof getMessaging> | null = null;

export async function initMessaging(): Promise<ReturnType<typeof getMessaging> | null> {
  if (messaging) return messaging;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) return null;
  try {
    const supported = await isSupported();
    if (supported) {
      messaging = getMessaging(app);
      return messaging;
    }
  } catch (err) {
    console.warn('FCM initialization failed:', err);
  }
  return null;
}

// Connect to emulators in development
if (import.meta.env.DEV) {
  try {
    connectAuthEmulator(auth, 'http://localhost:9099', {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectFunctionsEmulator(functions, 'localhost', 5001);
    connectStorageEmulator(storage, 'localhost', 9199);
  } catch {
    // Already connected
  }
}

export default app;
