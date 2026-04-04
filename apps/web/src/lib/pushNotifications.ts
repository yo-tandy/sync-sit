import { getToken, deleteToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { messaging, initMessaging, db } from '@/config/firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const PROMPTED_KEY = 'syncsit_push_prompted';

/**
 * Check if push notifications are supported in this browser.
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

/**
 * Check current permission status.
 */
export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Check if the user has already been prompted (soft prompt dismissed).
 */
export function wasPrompted(): boolean {
  return localStorage.getItem(PROMPTED_KEY) === 'true';
}

/**
 * Mark that we've prompted the user.
 */
export function markPrompted(): void {
  localStorage.setItem(PROMPTED_KEY, 'true');
}

/**
 * Reset the prompted flag (allow re-prompting).
 */
export function resetPrompted(): void {
  localStorage.removeItem(PROMPTED_KEY);
}

/**
 * Request push notification permission and save the FCM token.
 * This is the first point where FCM is initialized (lazily).
 * Returns the token if successful, null otherwise.
 */
export async function requestPushPermission(userId: string): Promise<string | null> {
  if (!VAPID_KEY) return null;

  // Initialize messaging lazily — only when user explicitly requests push
  const msg = await initMessaging();
  if (!msg) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const token = await getToken(msg, { vapidKey: VAPID_KEY });
    if (!token) return null;

    // Save token to user's fcmTokens array
    await updateDoc(doc(db, 'users', userId), {
      fcmTokens: arrayUnion(token),
    });

    return token;
  } catch (err) {
    console.error('Failed to get push token:', err);
    return null;
  }
}

/**
 * Remove the current FCM token from the user's doc and delete it from FCM.
 */
export async function removePushToken(userId: string): Promise<void> {
  const msg = messaging || await initMessaging();
  if (!msg) return;

  try {
    const token = await getToken(msg, { vapidKey: VAPID_KEY });
    if (token) {
      await updateDoc(doc(db, 'users', userId), {
        fcmTokens: arrayRemove(token),
      });
      await deleteToken(msg);
    }
  } catch (err) {
    console.error('Failed to remove push token:', err);
  }
}

/**
 * Set up foreground message handler. Shows an alert/toast when a push
 * arrives while the app is in the foreground.
 * Only initializes messaging if permission was already granted.
 */
export async function setupForegroundMessages(onNotification: (title: string, body: string) => void): Promise<() => void> {
  // Only init messaging if push is already granted — don't trigger the prompt
  if (Notification.permission !== 'granted') return () => {};

  const msg = await initMessaging();
  if (!msg) return () => {};

  return onMessage(msg, (payload) => {
    const title = payload.notification?.title || payload.data?.title || 'Sync/Sit';
    const body = payload.notification?.body || payload.data?.body || '';
    onNotification(title, body);
  });
}
