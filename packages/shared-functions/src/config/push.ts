import { db, messaging } from './firebase.js';
import type { NotificationApp } from './email.js';

// Per-app push branding (issue #168 Phase 0). study-web ships only logo.png
// as a public image asset — its favicon.png does not exist (SPA fallback).
const PUSH_BRANDING: Record<NotificationApp, { icon: string; link: string }> = {
  sit: { icon: 'https://sync-sit.com/favicon.png', link: 'https://sync-sit.com' },
  study: { icon: 'https://sync-study-app.web.app/logo.png', link: 'https://sync-study-app.web.app' },
};

/**
 * Send a push notification to a user via FCM, branded for the given app.
 * Loads their fcmTokens from Firestore and sends to all tokens.
 * Handles invalid tokens by removing them.
 * Fails silently — push failures should not block user actions.
 * Returns whether at least one token was actually delivered to, so callers
 * can record an honest pushSent audit field.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  app: NotificationApp = 'sit'
): Promise<boolean> {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const tokens: string[] = userDoc.data()?.fcmTokens || [];

    if (tokens.length === 0) return false;

    const { icon, link } = PUSH_BRANDING[app];

    // Send with notification payload — the browser handles display automatically.
    // The service worker's onBackgroundMessage skips showing if the browser already displayed it.
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data || {},
      webpush: {
        notification: {
          icon,
          badge: icon,
        },
        fcmOptions: {
          link,
        },
      },
    });

    console.log(`[PUSH] Sent to ${tokens.length} tokens: ${response.successCount} success, ${response.failureCount} failed`);

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = resp.error?.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        const { FieldValue } = require('firebase-admin/firestore');
        await db.collection('users').doc(userId).update({
          fcmTokens: FieldValue.arrayRemove(...invalidTokens),
        });
        console.log(`Removed ${invalidTokens.length} invalid FCM tokens for user ${userId}`);
      }
    }

    return response.successCount > 0;
  } catch (err) {
    console.error(`Failed to send push notification to ${userId}:`, err);
    // Don't throw — push failures should not block
    return false;
  }
}
