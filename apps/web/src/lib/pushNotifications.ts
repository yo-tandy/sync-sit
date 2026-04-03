import { getToken, deleteToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { messaging, db } from '@/config/firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const PROMPTED_KEY = 'syncsit_push_prompted';

/**
 * Check if push notifications are supported in this browser.
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && messaging !== null;
}

/**
 * Check if the user has already been prompted.
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
 * Request push notification permission and save the FCM token.
 * Returns the token if successful, null otherwise.
 */
export async function requestPushPermission(userId: string): Promise<string | null> {
  if (!messaging || !VAPID_KEY) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
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
  if (!messaging) return;

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (token) {
      await updateDoc(doc(db, 'users', userId), {
        fcmTokens: arrayRemove(token),
      });
      await deleteToken(messaging);
    }
  } catch (err) {
    console.error('Failed to remove push token:', err);
  }
}

/**
 * Set up foreground message handler. Shows an alert/toast when a push
 * arrives while the app is in the foreground.
 */
export function setupForegroundMessages(onNotification: (title: string, body: string) => void): () => void {
  if (!messaging) return () => {};

  return onMessage(messaging, (payload) => {
    const title = payload.notification?.title || 'Sync/Sit';
    const body = payload.notification?.body || '';
    onNotification(title, body);
  });
}
