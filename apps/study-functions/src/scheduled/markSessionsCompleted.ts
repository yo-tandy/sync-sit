import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import {
  parisDateString,
  parisWallTimeToUtc,
} from '@ejm/shared-functions/scheduled/parisTime.js';
import { dayOfWeek } from '@ejm/study-core';
import type { WeeklyGrid } from '../availability/computeDateAvailability.js';
import { buildRestoredOverride } from '../sessions/sessionOverride.js';

/** Previous calendar day of a 'YYYY-MM-DD' string (UTC math — DST-immune). */
function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface MarkCompletedStats {
  oneTimeCompleted: number;
  instancesCompleted: number;
  seriesCompleted: number;
  errors: number;
}

/**
 * Hourly bookkeeping: flip sessions past their end time to 'completed'. Silent —
 * no notifications (completion is a state transition, not an event a user acts
 * on). Three independent groups, each with PER-DOC try/catch isolation so one
 * poisoned doc can never abort the run (mirrors extendRecurring):
 *
 *   (a) one_time parents — confirmed, date in [yesterday, today] Paris, whose
 *       endTime has passed → completed. The [yesterday, today] window (not just
 *       today) catches a late-evening session whose completion straddles the
 *       Paris midnight the hourly cron rolls over.
 *   (b) recurring instances (collection-group) — scheduled, same window + end
 *       check → completed AND its override block PRUNED via buildRestoredOverride
 *       (self-pruning availability: a past occurrence stops holding the slot).
 *       Each runs in its own transaction (complete + prune together).
 *   (c) recurring PARENTS — the series-completion deferred from PR 3: confirmed,
 *       endDate strictly before today, and ZERO remaining 'scheduled' instances
 *       → completed. Run AFTER (b) so an instance completed this same tick counts
 *       toward "zero scheduled remaining".
 *
 * Extracted (injectable db + now) for testability; the cron wrapper passes the
 * real db and clock.
 */
export async function runMarkSessionsCompleted(
  firestoreDb: Firestore,
  now: Date,
): Promise<MarkCompletedStats> {
  const today = parisDateString(now);
  const yesterday = previousDate(today);
  const nowMs = now.getTime();

  const stats: MarkCompletedStats = {
    oneTimeCompleted: 0,
    instancesCompleted: 0,
    seriesCompleted: 0,
    errors: 0,
  };

  // Per-tutor weekly grid cache (the restoration base for override pruning).
  const weeklyCache = new Map<string, WeeklyGrid>();
  const weeklyFor = async (tutorUserId: string): Promise<WeeklyGrid> => {
    let weekly = weeklyCache.get(tutorUserId);
    if (!weekly) {
      const snap = await firestoreDb.collection('schedules').doc(tutorUserId).get();
      weekly = (snap.data()?.weekly as WeeklyGrid) ?? {};
      weeklyCache.set(tutorUserId, weekly);
    }
    return weekly;
  };

  // ── (a) one_time parents ── (status, date) composite serves this.
  const oneTimeSnap = await firestoreDb
    .collection('study-sessions')
    .where('status', '==', 'confirmed')
    .where('date', '>=', yesterday)
    .where('date', '<=', today)
    .get();
  for (const doc of oneTimeSnap.docs) {
    try {
      const s = doc.data();
      // Recurring parents carry no `date` (excluded by the range filter already),
      // but guard defensively: only concrete one_time sessions complete here.
      if (s.type !== 'one_time') continue;
      const endTime = s.endTime as string | undefined;
      if (!endTime) continue;
      if (parisWallTimeToUtc(s.date as string, endTime).getTime() < nowMs) {
        await doc.ref.update({ status: 'completed', completedAt: now, updatedAt: now });
        stats.oneTimeCompleted += 1;
      }
    } catch (err) {
      console.error(`markSessionsCompleted: one_time ${doc.id} failed`, err);
      stats.errors += 1;
    }
  }

  // ── (b) recurring instances (CG) + override pruning ──
  const instancesSnap = await firestoreDb
    .collectionGroup('instances')
    .where('status', '==', 'scheduled')
    .where('date', '>=', yesterday)
    .where('date', '<=', today)
    .get();
  for (const doc of instancesSnap.docs) {
    try {
      const inst = doc.data();
      const date = inst.date as string;
      const endTime = inst.endTime as string | undefined;
      if (!endTime) continue;
      if (parisWallTimeToUtc(date, endTime).getTime() >= nowMs) continue;

      const tutorUserId = inst.tutorUserId as string;
      const sessionId = inst.sessionId as string;
      const weekly = await weeklyFor(tutorUserId);
      const overrideRef = firestoreDb
        .collection('schedules').doc(tutorUserId)
        .collection('overrides').doc(date);

      // Complete + prune atomically. Re-read the instance under the lock so a
      // concurrent cancel can't be clobbered into 'completed'.
      await firestoreDb.runTransaction(async (tx) => {
        const freshInst = await tx.get(doc.ref);
        if (!freshInst.exists || freshInst.data()!.status !== 'scheduled') return;
        const oSnap = await tx.get(overrideRef);
        const existing = oSnap.exists ? oSnap.data()! : null;
        const restore = buildRestoredOverride({
          existing,
          sessionId,
          instanceId: date,
          weeklySlots: weekly[dayOfWeek(date)] ?? [],
          now,
        });
        tx.update(doc.ref, { status: 'completed', completedAt: now, updatedAt: now });
        if (restore.action === 'delete') tx.delete(overrideRef);
        else if (restore.action === 'set') tx.set(overrideRef, restore.doc);
      });
      stats.instancesCompleted += 1;
    } catch (err) {
      console.error(`markSessionsCompleted: instance ${doc.ref.path} failed`, err);
      stats.errors += 1;
    }
  }

  // ── (c) recurring parents whose series has fully run out ──
  // Equality-only query — served without a composite index (cf. extendRecurring).
  const seriesSnap = await firestoreDb
    .collection('study-sessions')
    .where('type', '==', 'recurring')
    .where('status', '==', 'confirmed')
    .get();
  for (const doc of seriesSnap.docs) {
    try {
      const endDate = doc.data().endDate as string | undefined;
      // Open-ended (no endDate) or not yet past → the series is still live.
      if (!endDate || endDate >= today) continue;
      // Any scheduled occurrence still outstanding → not done.
      const remaining = await doc.ref
        .collection('instances')
        .where('status', '==', 'scheduled')
        .limit(1)
        .get();
      if (!remaining.empty) continue;
      await doc.ref.update({ status: 'completed', completedAt: now, updatedAt: now });
      stats.seriesCompleted += 1;
    } catch (err) {
      console.error(`markSessionsCompleted: series ${doc.id} failed`, err);
      stats.errors += 1;
    }
  }

  return stats;
}

export const markSessionsCompleted = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
  },
  async () => {
    const stats = await runMarkSessionsCompleted(db, new Date());
    console.log(
      `markSessionsCompleted: ${stats.oneTimeCompleted} one_time, ${stats.instancesCompleted} instances, ${stats.seriesCompleted} series, ${stats.errors} errors`,
    );
  },
);
