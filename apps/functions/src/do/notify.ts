import type { NotificationType } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { resolveDoLang, type DoLang, type DoNotificationContent } from './notifyContent.js';

/**
 * sync-do notification send plumbing (plan §10, §13 PR9). Copy lives in
 * notifyContent.ts (pure, unit-pinned); this module owns the per-recipient
 * mechanics, mirroring the platform's senders exactly:
 *
 * - per-recipient LANGUAGE from the user doc (`language`, en|fr) — the EN+FR
 *   templates are selected here, not by the caller;
 * - existing NotifPrefs categories gate email/push per recipient
 *   (newRequest / confirmed / cancelled — the sit semantic mapping:
 *   respondToRequest uses confirmed for accepted, cancelled for declined).
 *   Deliberately NO per-app pref category is added: that is issue #168
 *   Phase-2 territory the plan tells this PR not to pre-empt (§10);
 * - email + push outcomes are recorded honestly on the NotificationDoc
 *   (emailSent/pushSent reflect what the transports reported);
 * - everything is branded app='do' — fcmTokensDo push routing and Sync/Do
 *   email branding (shared-functions tables).
 *
 * POST-COMMIT INVARIANT (the endorsementNotifications precedent): every
 * caller runs these AFTER its transaction committed, so nothing here may
 * reject the callable — wrap call-site blocks in notifyDoSafely.
 *
 * GUARDIAN COPIES COME FROM THE PLATFORM, NOT FROM CALL SITES (PR #334
 * review). Every doc written here trips `mirrorNotificationToGuardians`
 * (../guardian/onNotificationCreated.ts): a `notifications/{id}` create
 * whose RECIPIENT carries `governedBy` is CC'd to every parent of the
 * supervising family as a `guardian_mirror` copy (in-app + push,
 * kid-prefixed title, `data.originalType` preserved). A supervised doer's
 * notification therefore already reaches their parents, and a do call site
 * must NOT also notify the guardian family for the same event — that would
 * be two notices and two pushes for one thing. The rule for new call sites:
 *
 * - recipient is the supervised STUDENT → the guardian copy is automatic;
 *   write nothing extra (acceptOffer's winner, declineOffer, cancelTask's
 *   assigned doer and swept offerers, the digest, and
 *   decideOfferAsGuardian's child-facing notice);
 * - recipient is a PARENT being asked to act → not a mirror but an action
 *   request addressed to the parent themselves, and the call site's job
 *   (submitOffer's `task_guardian_approval`). It cannot double with the
 *   trigger: a parent recipient carries no `governedBy` of their own, so
 *   the mirror returns at its `governedBy` check.
 *
 * Whether do-world mirrors belong in the sit/study notification bells at
 * all is an owner decision tracked on issue #336 — untouched here.
 */

export type DoPrefCategory = 'newRequest' | 'confirmed' | 'cancelled';

export interface DoUserNotification {
  recipientUserId: string;
  /** Caller-supplied user doc data, to skip a refetch when already loaded. */
  recipientData?: Record<string, unknown>;
  type: NotificationType;
  /**
   * NotifPrefs category gating email/push — or null for NO pref gate (the
   * digest: `profiles.doer.notifyNewTasks` IS its opt-in, §3.3).
   */
  prefCategory: DoPrefCategory | null;
  /** Language-resolved copy — called once with the recipient's language. */
  content: (lang: DoLang) => DoNotificationContent;
  data?: Record<string, string>;
}

/**
 * Send email + push + in-app notification to one user, do-branded, honoring
 * the recipient's language and notification prefs.
 */
export async function sendDoNotificationToUser(
  n: DoUserNotification,
): Promise<void> {
  let userData = n.recipientData;
  if (!userData) {
    const snap = await db.collection('users').doc(n.recipientUserId).get();
    userData = snap.data() as Record<string, unknown> | undefined;
  }
  if (!userData) return;

  const lang = resolveDoLang(userData.language);
  const content = n.content(lang);
  const prefs = n.prefCategory
    ? (userData.notifPrefs as Record<string, { email?: boolean; push?: boolean } | undefined> | undefined)?.[
        n.prefCategory
      ]
    : undefined;

  let emailSent = false;
  if (prefs?.email !== false && typeof userData.email === 'string' && userData.email) {
    emailSent = await sendNotificationEmail(
      userData.email,
      content.subject,
      content.emailBody,
      'do',
    );
  }

  let pushSent = false;
  if (prefs?.push !== false) {
    pushSent = await sendPushNotification(
      n.recipientUserId,
      content.title,
      content.body,
      { ...n.data, type: n.type },
      'do',
    );
  }

  await db.collection('notifications').add({
    recipientUserId: n.recipientUserId,
    type: n.type,
    title: content.title,
    body: content.body,
    data: n.data || {},
    read: false,
    channels: ['email', 'push'],
    emailSent,
    pushSent,
    createdAt: new Date(),
  });
}

/**
 * Send to every parent of a family — the notifyAllParents shape, redone here
 * because do emails are per-recipient LOCALIZED (notifyAllParents takes one
 * prebuilt subject/body for all parents).
 */
export async function notifyDoFamilyParents(
  familyId: string,
  n: Omit<DoUserNotification, 'recipientUserId' | 'recipientData'>,
): Promise<void> {
  const familyDoc = await db.collection('families').doc(familyId).get();
  const parentIds: string[] = (familyDoc.data()?.parentIds as string[]) || [];
  for (const parentId of parentIds) {
    await sendDoNotificationToUser({ ...n, recipientUserId: parentId });
  }
}

/**
 * Post-commit guard: the transaction is committed, the caller's promise to
 * the client is made — a notification failure is logged, never thrown.
 */
export async function notifyDoSafely(
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[do-notify] ${label} failed after commit:`, err);
  }
}
