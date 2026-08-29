import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Firestore } from 'firebase-admin/firestore';
import type { TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { sendDoNotificationToUser } from './notify.js';
import { buildNewTaskDigest, type DigestTaskLine } from './notifyContent.js';
import { tsMillis } from './offerAccess.js';

/**
 * `doSendTaskDigest` — the §10 board digest, §8's row exactly: a scheduled
 * BATCHER, not an on-create fan-out. Batches `new_task_matching` for
 * students whose `profiles.doer.categories` match tasks created since their
 * last digest, at most one digest per student per 6 hours. The batcher
 * shape is deliberate: the rate limit is per-RECIPIENT, so an on-create
 * trigger would need per-student dedupe state anyway — and the batcher IS
 * that state (`lastDigestAt`, §3.3).
 *
 * Recipient query = the §7.3 `users` composite VERBATIM:
 *   (status ==, profiles.doer.notifyNewTasks ==, profiles.doer.categories
 *    array-contains-any) — chunked to Firestore's 30-value ceiling.
 * `enrollmentComplete` and the `lastDigestAt` window are filtered IN MEMORY
 * (§7.3's note: do NOT widen the composite — the index exists for exactly
 * these three fields, and its absence surfaces as FAILED_PRECONDITION
 * inside a scheduled job where nobody watches a browser console).
 *
 * `lastDigestAt` is server-owned: written here via the Admin SDK, never
 * client-writable (§3.3). Absent means never digested — treated as
 * "everything since the profile was created", bounded in practice by the
 * candidate-task lookback below (the §3.3 profile carries no creation
 * timestamp to anchor on, and a run only ever considers recent tasks).
 *
 * Digest content is BOARD-VISIBLE fields only (title, category, area
 * label, suggested budget) — the §7.2 board audience already reads all of
 * these; nothing that locates or identifies a family beyond the board.
 */

/** At most one digest per student per this window (§8/§10: 6 hours). */
export const DO_DIGEST_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Candidate-task lookback. Bounds the doTasks query (status ==, createdAt
 * range — the §7.3 `(status, createdAt)` board composite serves it) and
 * therefore the largest first digest a never-digested student can receive.
 * 7 days: comfortably wider than any 6h digest cadence gap, narrower than
 * the board's own expiry horizon.
 */
export const DO_DIGEST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Firestore's array-contains-any disjunct ceiling. V1 has seven categories,
 *  so one chunk — the chunking is here so a grown taxonomy cannot silently
 *  break the recipient query. */
const ARRAY_CONTAINS_ANY_MAX = 30;

export interface DoDigestStats {
  tasksConsidered: number;
  recipientsMatched: number;
  digestsSent: number;
  /** Recipients whose digest threw and was skipped — the run's only other
   *  observability besides the summary log (PR #334 review). */
  errors: number;
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

export async function runDoSendTaskDigest(
  firestoreDb: Firestore,
  now: Date,
): Promise<DoDigestStats> {
  const stats: DoDigestStats = {
    tasksConsidered: 0,
    recipientsMatched: 0,
    digestsSent: 0,
    errors: 0,
  };

  // ── 1. Candidate tasks: OPEN, recent, unexpired ──
  const since = new Date(now.getTime() - DO_DIGEST_LOOKBACK_MS);
  const tasksSnap = await firestoreDb
    .collection('doTasks')
    .where('status', '==', 'open')
    .where('createdAt', '>', since)
    .get();
  const tasks = tasksSnap.docs
    .map((d) => d.data() as TaskDoc)
    .filter((t) => tsMillis(t.expiresAt) > now.getTime());
  stats.tasksConsidered = tasks.length;
  if (tasks.length === 0) return stats;

  const categories = [...new Set(tasks.map((t) => t.category))];

  // ── 2. Recipients: the §7.3 composite, chunked, merged by uid ──
  const recipients = new Map<string, Record<string, unknown>>();
  for (const catChunk of chunk(categories, ARRAY_CONTAINS_ANY_MAX)) {
    const snap = await firestoreDb
      .collection('users')
      .where('status', '==', 'active')
      .where('profiles.doer.notifyNewTasks', '==', true)
      .where('profiles.doer.categories', 'array-contains-any', catChunk)
      .get();
    for (const doc of snap.docs) {
      recipients.set(doc.id, doc.data() as Record<string, unknown>);
    }
  }
  stats.recipientsMatched = recipients.size;

  // ── 3. Per recipient: in-memory filters, batch, send, stamp ──
  //
  // The whole body is per-recipient ISOLATED (PR #334 review). The
  // transports inside sendDoNotificationToUser are already fail-safe, but
  // its `notifications.add()`, the `users` stamp below and a malformed user
  // doc can all still reject — and unguarded, one bad recipient aborted the
  // entire scheduled run: every recipient after it got nothing that hour and
  // the summary log never printed. Log it, count it, carry on. Nothing is
  // lost: `lastDigestAt` is stamped only on success, so a failed recipient
  // is picked up by the next hourly run.
  for (const [uid, userData] of recipients) {
    try {
      const doer = (
        (userData.profiles ?? {}) as Record<string, Record<string, unknown> | undefined>
      ).doer;
      // §7.3 in-memory half 1: only enrolled doers — the composite must not
      // carry this equality.
      if (doer?.enrollmentComplete !== true) continue;

      // §7.3 in-memory half 2: the 6h per-recipient rate limit. Absent means
      // never digested.
      const lastDigestMs = doer.lastDigestAt ? tsMillis(doer.lastDigestAt) : null;
      if (
        lastDigestMs !== null &&
        now.getTime() - lastDigestMs < DO_DIGEST_MIN_INTERVAL_MS
      ) {
        continue;
      }

      // "Tasks created since their last digest", matched on the student's own
      // category list (array-contains-any can over-match across chunks).
      const cats = new Set((doer.categories as string[] | undefined) ?? []);
      const sinceMs = lastDigestMs ?? 0;
      const matching = tasks
        .filter((t) => cats.has(t.category) && tsMillis(t.createdAt) > sinceMs)
        .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
      if (matching.length === 0) continue;

      const lines: DigestTaskLine[] = matching.map((t) => ({
        taskId: t.taskId,
        title: t.title,
        category: t.category,
        areaLabel: t.areaLabel,
        suggestedBudget: t.suggestedBudget,
      }));

      // prefCategory null: `profiles.doer.notifyNewTasks` IS the opt-in
      // (§3.3) — the shared NotifPrefs categories do not gate the digest, and
      // no per-app pref category is added (issue #168 Phase-2, plan §10).
      await sendDoNotificationToUser({
        recipientUserId: uid,
        recipientData: userData,
        type: 'new_task_matching',
        prefCategory: null,
        content: (lang) => buildNewTaskDigest(lang, lines),
        data: { taskCount: String(lines.length) },
      });

      // The per-recipient dedupe state (§3.3: "the batcher IS that state").
      // Admin SDK write — server-WRITTEN, but NOT rules-pinned (this
      // corrects an over-claiming comment, PR #334 review):
      // `doerIdentityUnchanged()` pins only
      // `profiles.doer.enrollmentComplete`, `doerBoundsValid()` bounds
      // bio/defaultRate/categories, and the `users` update allow-list does
      // not block nested `profiles.doer.*` — so the owner CAN write this
      // field. Left unpinned deliberately: the blast radius is the owner's
      // own inbox. Backdating or clearing it makes them eligible for their
      // own digest sooner (at most once per hourly run, listing their own
      // board matches); a far-future value silences their own digest.
      // Neither touches another user, and §3.3 claims only "server-owned
      // (the batcher writes it)". Worth pinning in `doerIdentityUnchanged()`
      // if this field ever gates anything beyond self-directed mail.
      await firestoreDb
        .collection('users')
        .doc(uid)
        .update({ 'profiles.doer.lastDigestAt': now });
      stats.digestsSent += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`[doSendTaskDigest] recipient ${uid} failed:`, err);
    }
  }

  console.log(
    `[doSendTaskDigest] tasks=${stats.tasksConsidered} matched=${stats.recipientsMatched} sent=${stats.digestsSent} errors=${stats.errors}`,
  );
  return stats;
}

/**
 * Hourly beside `sendReminders` (its schedule/region/timeZone shape); each
 * recipient still gets at most one digest per 6h via `lastDigestAt` — the
 * hourly cadence just bounds how stale a digest can be, it does not set the
 * rate. A separate job (unlike `doSweepTasks`, which rides the DAILY
 * `cleanupOldData` run) because a daily cadence cannot honor a 6h limit.
 */
export const doSendTaskDigest = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
  },
  async () => {
    await runDoSendTaskDigest(db, new Date());
  },
);
