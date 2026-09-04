import { db } from '../config/firebase.js';
import { escapeHtml, sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

/**
 * The counterparty fan-out of a member erasure (issue #420).
 *
 * `eraseUserAccount` cancels every pending/confirmed sit appointment and study
 * session the erased member was part of — and until this module existed it
 * told nobody on the other side: a family woke up to a sitter-less Saturday
 * with no email, no push and no in-app row, and the `account_deleted`
 * NotificationType sat in the union with no writer anywhere. This is that
 * writer.
 *
 * WHO is a counterparty:
 *   - provider (babysitter/tutor) erased → the surviving FAMILY of each
 *     cancelled engagement. A family is notified through its parents — every
 *     uid in `families/{id}.parentIds`, the same resolution
 *     `notifyGuardiansOfSelfDelete` uses.
 *   - last parent of a family erased (the family itself is deleted) → the
 *     surviving PROVIDER of each cancelled engagement, addressed directly by
 *     uid.
 *
 * ONE notification per distinct recipient per world (sit / study), not one per
 * engagement: the caller aggregates counts per familyId / provider uid, and a
 * family with three cancelled appointments produces a single message saying
 * three. A member affected in BOTH worlds (their family had a sit appointment
 * AND a study session with the erased member) gets one message per world —
 * they carry different types (`account_deleted` vs `study_account_deleted`),
 * different branding, and land in different apps' bells.
 *
 * Best-effort by design, like `notifyGuardiansOfSelfDelete`: the erasure has
 * fully committed by the time this runs, so a failing channel must never
 * surface as a failed deletion. Each recipient is isolated in try/catch — one
 * poisoned recipient (missing user doc, rejected email) costs only their own
 * message, never the rest of the loop.
 *
 * notifPrefs are deliberately NOT consulted, mirroring the guardian notify:
 * none of the booking-chatter categories describes "the other party left the
 * platform and your engagement is void", and a member who muted `cancelled`
 * emails would otherwise silently never learn their Saturday sitter is gone.
 *
 * Returns the guardian notify's two counts, for the caller's audit entry:
 *   - `found`   — distinct recipients the cancelled engagements resolve to.
 *   - `reached` — recipients at least one CHANNEL actually delivered to.
 * `found > reached` in an audit entry is the signal to look. The in-app doc is
 * written unconditionally and deliberately does not count as a channel.
 */

/** Which app's engagement was cancelled — decides type, branding and push world. */
type ErasureWorld = 'sit' | 'study';

/** Which side of the engagement the recipient stood on. */
type ErasureAudience = 'family' | 'provider';

export interface ErasureCounterpartyTargets {
  /** sit: cancelled-appointment counts keyed by the surviving family's id. */
  sitFamilies: Map<string, number>;
  /** sit: cancelled-appointment counts keyed by the surviving babysitter's uid. */
  sitProviders: Map<string, number>;
  /** study: cancelled-session counts keyed by the surviving family's id. */
  studyFamilies: Map<string, number>;
  /** study: cancelled-session counts keyed by the surviving tutor's uid. */
  studyTutors: Map<string, number>;
}

export function emptyCounterpartyTargets(): ErasureCounterpartyTargets {
  return {
    sitFamilies: new Map(),
    sitProviders: new Map(),
    studyFamilies: new Map(),
    studyTutors: new Map(),
  };
}

/** One resolved recipient: a real uid, what happened to them, and how often. */
interface ResolvedRecipient {
  uid: string;
  world: ErasureWorld;
  audience: ErasureAudience;
  count: number;
}

/**
 * The human copy, per world and side. `erasedName` MAY be empty (an account
 * with no name fields); the copy then falls back to the role noun rather than
 * rendering a floating space — the counterparty knew the person by name, so
 * when we have it we say it, the same call `notifyGuardiansOfSelfDelete`
 * settled for the guardian message (the name lives in the human copy ONLY,
 * never in the structured payload).
 */
function buildCopy(
  world: ErasureWorld,
  audience: ErasureAudience,
  erasedName: string,
  count: number,
): { title: string; body: string } {
  const engagement = world === 'sit' ? 'appointment' : 'tutoring session';
  const things = count === 1 ? `Your ${engagement} with them was` : `Your ${count} ${engagement}s with them were`;
  if (audience === 'family') {
    const role = world === 'sit' ? 'babysitter' : 'tutor';
    const name = erasedName || `Your ${role}`;
    return {
      title: `Your ${role}'s account was deleted`,
      body: `${name} is no longer on the platform — their account was deleted. ${things} cancelled.`,
    };
  }
  const name = erasedName ? `${erasedName}'s family` : 'A family you worked with';
  return {
    title: "A family's account was deleted",
    body: `${name} is no longer on the platform — their account was deleted. ${things} cancelled and the blocked time slots were reopened in your schedule.`,
  };
}

/**
 * Resolve the target maps to distinct recipient uids.
 *
 * Families resolve through `families/{id}.parentIds`; a family whose document
 * is gone (or was the erased member's own, already deleted by step 4)
 * contributes nobody — there is no one left to tell, which is a different
 * thing from a lookup that THREW (isolated per family, logged, and skipped so
 * the other families still get their parents resolved).
 *
 * The erased member and the `'deleted'` sentinel are filtered out everywhere:
 * a target map built from raw document fields may name either.
 */
async function resolveRecipients(
  targets: ErasureCounterpartyTargets,
  erasedUserId: string,
): Promise<ResolvedRecipient[]> {
  const out = new Map<string, ResolvedRecipient>();
  const add = (uid: string, world: ErasureWorld, audience: ErasureAudience, count: number) => {
    if (!uid || uid === 'deleted' || uid === erasedUserId) return;
    const key = `${world}:${uid}`;
    const existing = out.get(key);
    if (existing) existing.count += count;
    else out.set(key, { uid, world, audience, count });
  };

  const familySides: [Map<string, number>, ErasureWorld][] = [
    [targets.sitFamilies, 'sit'],
    [targets.studyFamilies, 'study'],
  ];
  for (const [families, world] of familySides) {
    for (const [familyId, count] of families) {
      try {
        const familyDoc = await db.collection('families').doc(familyId).get();
        const parentIds: string[] = familyDoc.data()?.parentIds ?? [];
        for (const parentId of parentIds) add(parentId, world, 'family', count);
      } catch (err) {
        console.error(
          `notifyErasureCounterparties: family ${familyId} lookup failed (${world}):`,
          err,
        );
      }
    }
  }

  for (const [uid, count] of targets.sitProviders) add(uid, 'sit', 'provider', count);
  for (const [uid, count] of targets.studyTutors) add(uid, 'study', 'provider', count);

  return [...out.values()];
}

export async function notifyErasureCounterparties(
  erasedUserId: string,
  targets: ErasureCounterpartyTargets,
  erasedName: string,
  now: Date,
): Promise<{ found: number; reached: number }> {
  const recipients = await resolveRecipients(targets, erasedUserId);

  const found = recipients.length;
  let reached = 0;
  for (const recipient of recipients) {
    // Per-recipient isolation: the erasure has already committed in full, so
    // one poisoned recipient must not cost the rest their only warning.
    try {
      const userData = (await db.collection('users').doc(recipient.uid).get()).data();
      if (!userData) continue;

      const { title, body } = buildCopy(
        recipient.world,
        recipient.audience,
        erasedName,
        recipient.count,
      );
      const type =
        recipient.world === 'sit' ? 'account_deleted' : 'study_account_deleted';

      let emailSent = false;
      if (userData.email) {
        emailSent = await sendNotificationEmail(
          userData.email,
          title,
          // The name appears in the HUMAN copy only (see buildCopy); the
          // structured payload below stays count-only.
          `<p>${escapeHtml(body)}</p>
           <p>We are sorry for the disruption. You can arrange a replacement from the app.</p>`,
          // Branding follows the world whose engagement was cancelled —
          // `sendNotificationEmail` has no 'auto', and a study session's
          // cancellation carrying sit branding would name the wrong app.
          recipient.world,
        );
      }

      // 'auto' resolves per recipient to whichever app's PWA they actually
      // installed (the guardianAccess / createKidInvite convention); the world
      // is passed as the tie-break HINT for dual installs, so a study
      // cancellation prefers the study PWA without ever short-circuiting a
      // recipient who only holds sit tokens.
      const pushSent = await sendPushNotification(
        recipient.uid,
        title,
        body,
        { type, cancelledCount: String(recipient.count) },
        'auto',
        recipient.world,
      );

      await db.collection('notifications').add({
        recipientUserId: recipient.uid,
        type,
        title,
        body,
        // Count only. The engagements the ids would point at are already
        // cancelled and anonymized, a per-recipient rollup has no single
        // appointmentId, and nothing downstream should be able to re-derive
        // anything about an account that no longer exists — the same
        // structured-payload rule `deleteMyAccount`'s `data: { childUid }`
        // states.
        data: { cancelledCount: String(recipient.count) },
        read: false,
        channels: ['email', 'push'],
        emailSent,
        pushSent,
        createdAt: now,
      });
      // Only a delivered channel counts; the in-app doc is unconditional and
      // counting it would make `reached` unconditional too.
      if (emailSent || pushSent) reached += 1;
    } catch (err) {
      console.error('notifyErasureCounterparties: failed for one recipient', {
        recipientUid: recipient.uid,
        world: recipient.world,
        err,
      });
    }
  }
  return { found, reached };
}
