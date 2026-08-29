import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../config/firebase.js';
import { escapeHtml, sendNotificationEmail } from '../config/email.js';
import { derivePushWorld, sendPushNotification } from '../config/push.js';

/**
 * Guardian notification mirroring (governance design: "child notifications CC
 * the supervising family"). One trigger on the shared `notifications`
 * collection — it deploys once, from the sit codebase, and covers both apps'
 * notification writers.
 *
 * When the recipient's user doc carries the `governedBy` mirror, every parent
 * of that family gets an in-app COPY (`type: 'guardian_mirror'`, kid-prefixed
 * title, original type preserved in data) + push. The kid's own notification
 * is untouched. Guardian-flow types are skipped: `guardian_mirror` (a mirror
 * of a mirror would loop) and `supervision_request` (the parent initiated it —
 * mirroring it back is pure noise).
 *
 * Retry safety: mirror doc ids are deterministic (`{originalId}_{parentUid}`)
 * and written with set(), so an event redelivery overwrites instead of
 * duplicating.
 */
const SKIP_TYPES = new Set(['guardian_mirror', 'supervision_request']);

/**
 * Conservative original-type → notifPrefs category map for the EMAIL channel.
 * A type not listed here is unmappable: the mirror stays in-app + push only,
 * because guessing a category could email a parent who opted that category
 * out.
 */
const EMAIL_PREF_CATEGORY: Record<string, 'newRequest' | 'confirmed' | 'cancelled'> = {
  new_request: 'newRequest',
  contact_sharing_request: 'newRequest',
  study_contact_request: 'newRequest',
  request_accepted: 'confirmed',
  // A family's modification of a supervised tutor's session: same urgency
  // class as a new request -- the guardian should see schedule changes
  // (issue #234 review; study_session_request remains a pre-existing gap
  // documented below).
  study_session_modified: 'newRequest',
  study_session_confirmed: 'confirmed',
  study_request_accepted: 'confirmed',
  request_cancelled: 'cancelled',
  request_declined: 'cancelled',
  study_session_cancelled: 'cancelled',
  study_session_declined: 'cancelled',
  study_request_declined: 'cancelled',
  // Published-search inversion (issue #207 PR3). Without these, a governed
  // sitter's guardian gets the mirror in-app and by push but never by email.
  published_search_contact: 'newRequest',
  published_search_accepted: 'confirmed',
  published_search_declined: 'cancelled',
  // sync-do (plan §10; PR #334 round-2 review). doAcceptOffer stopped writing
  // an explicit guardian notice because this mirror already CCs the
  // supervising parents — but without these entries that CC was push +
  // in-app only, and a supervising parent with no push tokens was left with
  // an in-app row no surface renders yet. Mapping restores the email leg
  // through the SAME single mirror, with no duplication. Categories follow
  // the platform's existing semantics above: an outcome the student was
  // waiting for is `confirmed`, something falling through is `cancelled`,
  // and a change to committed work is `newRequest` (the
  // `study_session_modified` precedent).
  task_offer_accepted: 'confirmed',
  task_marked_done: 'confirmed',
  task_offer_declined: 'cancelled',
  task_cancelled: 'cancelled',
  task_updated: 'newRequest',
  // DELIBERATELY UNMAPPED do types (in-app + push only, per this map's
  // conservative rule):
  // - `task_guardian_approval`: on the child-facing half a parent of this
  //   very family just made the decision, so emailing the family back is the
  //   `supervision_request` kind of noise this trigger already skips; the
  //   parent-facing approval REQUEST is a different write that submitOffer
  //   emails directly (its recipients are parents, who carry no `governedBy`
  //   and so never reach this trigger at all).
  // - `new_task_matching`: the board digest is informational and runs up to
  //   4x a day per student; mirroring it by email would make a parent's inbox
  //   the busiest surface in sync-do. The push/in-app copy still reaches them.
  // - `task_offer_received` / `task_assigned`: only ever addressed to hiring
  //   parents (or, for `task_assigned`, to nobody — it has no sender since
  //   the round-1 dedupe), and a parent carries no `governedBy`, so neither
  //   can reach this map.
};

export const mirrorNotificationToGuardians = onDocumentCreated(
  { document: 'notifications/{notificationId}', region: 'europe-west1' },
  async (event) => {
    const original = event.data?.data();
    if (!original) return;

    const originalType = (original.type as string) ?? '';
    if (SKIP_TYPES.has(originalType)) return;

    const recipientUserId = original.recipientUserId as string | undefined;
    if (!recipientUserId) return;

    const recipient = (await db.collection('users').doc(recipientUserId).get()).data();
    const familyId = recipient?.governedBy?.familyId as string | undefined;
    if (!familyId) return;

    const family = (await db.collection('families').doc(familyId).get()).data();
    const parentIds: string[] = Array.isArray(family?.parentIds) ? family.parentIds : [];
    const kidName = (recipient?.firstName as string) || 'Your kid';
    const title = `[${kidName}] ${original.title ?? ''}`.trim();
    const body = (original.body as string) ?? '';
    const originalHadEmailIntent =
      Array.isArray(original.channels) && original.channels.includes('email');
    const emailCategory = EMAIL_PREF_CATEGORY[originalType];
    const now = new Date();

    for (const parentUid of parentIds) {
      if (parentUid === recipientUserId) continue; // defensive: never self-mirror

      const parent = (await db.collection('users').doc(parentUid).get()).data();
      const prefs = emailCategory ? parent?.notifPrefs?.[emailCategory] : undefined;
      const sendEmail =
        originalHadEmailIntent &&
        emailCategory !== undefined &&
        prefs?.email !== false &&
        typeof parent?.email === 'string';

      await db
        .collection('notifications')
        .doc(`${event.params.notificationId}_${parentUid}`)
        .set({
          recipientUserId: parentUid,
          type: 'guardian_mirror',
          title,
          body,
          data: {
            ...((original.data as Record<string, unknown>) ?? {}),
            mirroredFrom: recipientUserId,
            originalType,
          },
          read: false,
          channels: sendEmail ? ['email', 'push'] : ['push'],
          emailSent: sendEmail,
          pushSent: false,
          createdAt: now,
        });

      if (sendEmail) {
        await sendNotificationEmail(
          parent!.email as string,
          title,
          `<p>${escapeHtml(body)}</p>
           <p style="color: #6B7280; font-size: 14px;">You receive this copy because you
           supervise ${escapeHtml(kidName)}'s account.</p>`,
        );
      }
      // app='auto': the parent's app affinity is theirs, not the kid's. The
      // mirrored type tells us which world the event came from — that world
      // breaks the tie for parents with tokens in both arrays (#168 Phase 2).
      await sendPushNotification(
        parentUid,
        title,
        body,
        {
          mirroredFrom: recipientUserId,
          originalType,
          type: 'guardian_mirror',
        },
        'auto',
        derivePushWorld(originalType),
      );
    }
  },
);
