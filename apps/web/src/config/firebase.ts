import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';
import { resolveEmulatorConfig } from '@ejm/shared-core';

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

// Connect to emulators in development.
//
// The endpoint comes from VITE_EMULATOR_* env (issue #358) so a browser-driven
// e2e run can select its own emulator lane instead of commandeering the shared
// lane-1 dev stack. With none of those vars set the values are exactly the
// lane-1 ones this block used to hardcode — see
// packages/shared-core/src/utils/emulatorConfig.ts and docs/emulator-lanes.md.
//
// The resolve call sits OUTSIDE the try: a malformed var must fail loudly, not
// be swallowed by the "already connected" catch and silently leave the app on
// lane 1.
if (import.meta.env.DEV) {
  const emulator = resolveEmulatorConfig(import.meta.env);
  try {
    connectAuthEmulator(auth, emulator.authUrl, {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, emulator.host, emulator.firestorePort);
    connectFunctionsEmulator(functions, emulator.host, emulator.functionsPort);
    connectStorageEmulator(storage, emulator.host, emulator.storagePort);
  } catch {
    // Already connected
  }
}

export default app;
