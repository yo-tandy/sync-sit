import { FieldValue } from 'firebase-admin/firestore';
import { db, messaging } from './firebase.js';
import { DO_APP_URL, SIT_APP_URL, STUDY_APP_URL } from './email.js';
import type { NotificationApp } from './email.js';

// Per-app push branding (issue #168 Phase 0). The study icon is the 512px
// manifest variant (apps/study-web/public/icon-512.png) — the full logo.png
// is 1.6MB, absurd to fetch per notification render (PR #192 review).
const PUSH_BRANDING: Record<NotificationApp, { icon: string; link: string }> = {
  // sit's icon is the downscaled 192px manifest variant (issue #193) — the
  // old favicon.png is a 1.4MB fetch per notification render, same class of
  // cost study's icon fix removed (PR #192).
  sit: { icon: `${SIT_APP_URL}/icon-192.png`, link: SIT_APP_URL },
  study: { icon: `${STUDY_APP_URL}/icon-512.png`, link: STUDY_APP_URL },
  // do's icon follows sit's choice: the 192px manifest variant is plenty for
  // a notification render (sync-do plan §13 PR9).
  do: { icon: `${DO_APP_URL}/icon-192.png`, link: DO_APP_URL },
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
// PER-RECIPIENT AFFINITY (issue #168 Phase 2): the shared guardian callables
// (createKidInvite, revokeSupervision, forceRevokeSupervision,
// guardianSetChildSearchable, guardianAccess) and the guardian mirror trigger
// send to a recipient whose app affinity the CALLER doesn't know — threading
// the caller's app would route by the wrong side of the conversation. Those
// callers pass app='auto', which resolves per recipient from the same user
// doc the send already fetches:
// - tokens in exactly one array -> that app's tokens and branding;
// - tokens in BOTH arrays -> the `world` hint if the caller knows which
//   world the event belongs to (the mirror derives it from the mirrored
//   type via derivePushWorld), otherwise 'sit' — the pre-Phase-2 behavior
//   for dual-install users;
// - tokens in neither -> the usual empty short-circuit (returns false).
// Invalid-token cleanup always writes back to the array actually used.
// Callers that DO know the recipient-facing app keep passing it explicitly.
const PUSH_TOKEN_FIELDS: Record<NotificationApp, string> = {
  sit: 'fcmTokens',
  study: 'fcmTokensStudy',
  // do's registrations follow the established per-app pattern (plan §10 —
  // unification is issue #168 Phase-2 territory, not sync-do's to pre-empt).
  do: 'fcmTokensDo',
};

/**
 * Derive which app's WORLD a notification type belongs to, for use as the
 * `world` hint of an app='auto' push. Study-world types are prefixed
 * (`study_*`, plus the `tutor_endorsement_*` family); do-world types are the
 * §10 task set (`task_*`, `new_task_matching`, plus the `doer_endorsement_*`
 * family); everything else is sit. The guardian mirror uses this on the
 * mirrored notification's original type.
 */
export function derivePushWorld(notificationType: string): NotificationApp {
  if (
    notificationType.startsWith('study_') ||
    notificationType.startsWith('tutor_endorsement_')
  ) {
    return 'study';
  }
  if (
    notificationType.startsWith('task_') ||
    notificationType === 'new_task_matching' ||
    notificationType.startsWith('doer_endorsement_')
  ) {
    return 'do';
  }
  return 'sit';
}

/**
 * Send a push notification to a user via FCM, branded for the given app.
 * Loads the app's token array from Firestore (`fcmTokens` for sit,
 * `fcmTokensStudy` for study) and sends to all tokens.
 * app='auto' resolves the app per recipient from their token arrays (see the
 * affinity comment above PUSH_TOKEN_FIELDS); `world` is the optional
 * tie-breaker hint for recipients with tokens in both arrays, ignored
 * otherwise.
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
  app: NotificationApp | 'auto' = 'sit',
  world?: NotificationApp
): Promise<boolean> {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    let resolvedApp: NotificationApp;
    if (app === 'auto') {
      // Three-way affinity (sync-do plan §13 PR9 extends the #168 Phase-2
      // pair): tokens in exactly one array -> that app; several arrays ->
      // the `world` hint when THAT app actually holds tokens (a hint naming
      // an empty array would short-circuit to a false negative), otherwise
      // 'sit' — the pre-Phase-2 default, preserved for dual sit+study
      // installs; none -> 'sit', whose empty short-circuit below returns
      // false as before.
      const installed = (['sit', 'study', 'do'] as const).filter(
        (a) => ((userData?.[PUSH_TOKEN_FIELDS[a]] as string[]) || []).length > 0,
      );
      if (installed.length === 1) {
        resolvedApp = installed[0];
      } else if (world && installed.includes(world)) {
        resolvedApp = world;
      } else if (installed.includes('sit') || installed.length === 0) {
        resolvedApp = 'sit';
      } else {
        // study+do dual install, no usable hint: prefer study — the older
        // sibling, mirroring the sit-first tie-break one tier up.
        resolvedApp = 'study';
      }
    } else {
      resolvedApp = app;
    }

    const tokensField = PUSH_TOKEN_FIELDS[resolvedApp];
    const tokens: string[] = userData?.[tokensField] || [];

    if (tokens.length === 0) return false;

    const { icon, link } = PUSH_BRANDING[resolvedApp];

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
