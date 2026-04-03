import { db, messaging } from './firebase.js';

/**
 * Send a push notification to a user via FCM.
 * Loads their fcmTokens from Firestore and sends to all tokens.
 * Handles invalid tokens by removing them.
 * Fails silently — push failures should not block user actions.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const tokens: string[] = userDoc.data()?.fcmTokens || [];

    if (tokens.length === 0) return;

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data || {},
      webpush: {
        notification: {
          icon: 'https://sync-sit.com/favicon.png',
          badge: 'https://sync-sit.com/favicon.png',
        },
        fcmOptions: {
          link: 'https://sync-sit.com',
        },
      },
    });

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
  } catch (err) {
    console.error(`Failed to send push notification to ${userId}:`, err);
    // Don't throw — push failures should not block
  }
}
