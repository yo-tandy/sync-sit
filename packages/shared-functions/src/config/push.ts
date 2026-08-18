import { FieldValue } from 'firebase-admin/firestore';
import { db, messaging } from './firebase.js';
import { STUDY_APP_URL } from './email.js';
import type { NotificationApp } from './email.js';

// Per-app push branding (issue #168 Phase 0). The study icon is the 512px
// manifest variant (apps/study-web/public/icon-512.png) — the full logo.png
// is 1.6MB, absurd to fetch per notification render (PR #192 review).
const PUSH_BRANDING: Record<NotificationApp, { icon: string; link: string }> = {
  sit: { icon: 'https://sync-sit.com/favicon.png', link: 'https://sync-sit.com' },
  study: { icon: `${STUDY_APP_URL}/icon-512.png`, link: STUDY_APP_URL },
};

// Per-app token arrays (issue #168 Phase 1). The sit and study PWAs are
// separate installs on separate origins, so their FCM registrations must not
// mix: a study-branded push sent to a sit token would surface under the sit
// app (and vice versa). The legacy flat `fcmTokens` array stays sit's — every
// token stored before study push shipped came from the sit client — and study
// registrations live in the sibling `fcmTokensStudy` field. No migration.
//
// TRANSITION GAP (accepted): before this split, study callables already
// passed app='study' for branding but still read `fcmTokens` — so a user
// with sit installed and study in a browser tab DID get study pushes,
// mis-branded onto their sit install. Post-split their `fcmTokensStudy` is
// empty and study pushes stop until they install the study PWA and grant
// permission. Degradation is honest (notification doc with pushSent:false,
// email still fires) and InstallAppBanner is the recovery path.
//
// KNOWN GAP (issue #168 ledger, Phase 2): the shared guardian callables
// (createKidInvite, revokeSupervision, forceRevokeSupervision,
// guardianSetChildSearchable, guardianAccess) never pass `app`, so they fall
// through to the 'sit' default and read only `fcmTokens`. A study-only
// recipient (tokens in `fcmTokensStudy` alone) silently misses those pushes,
// degrading to the in-app notification doc with an honest pushSent:false.
// Threading the CALLER's app would be wrong — the push goes to the
// child/guardian, whose app affinity the caller doesn't know; correct
// routing needs per-recipient affinity or send-to-both (Phase 2 design).
const PUSH_TOKEN_FIELDS: Record<NotificationApp, string> = {
  sit: 'fcmTokens',
  study: 'fcmTokensStudy',
};

/**
 * Send a push notification to a user via FCM, branded for the given app.
 * Loads the app's token array from Firestore (`fcmTokens` for sit,
 * `fcmTokensStudy` for study) and sends to all tokens.
 * Handles invalid tokens by removing them from the same array.
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
    const tokensField = PUSH_TOKEN_FIELDS[app];
    const userDoc = await db.collection('users').doc(userId).get();
    const tokens: string[] = userDoc.data()?.[tokensField] || [];

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
        await db.collection('users').doc(userId).update({
          [tokensField]: FieldValue.arrayRemove(...invalidTokens),
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
