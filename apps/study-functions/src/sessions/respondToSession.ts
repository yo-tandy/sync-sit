import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { parisWallClockPosition, parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
import { timeToSlotIndex } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import {
  computeDayAvailability,
  dayOfWeek,
  type ConfirmedBlock,
  type DayOverride,
} from '@ejm/study-core';
import { respondToSessionSchema } from '../validation/session.js';

/** Notice window: a session cannot be confirmed within this many hours of "now". */
const NOTICE_HOURS = 24;
const SLOTS_PER_DAY = 96;
const SLOT_MINUTES = 15;

/** Locations whose in-person sessions need travel/prep padding (mirrors study-core). */
const PADDED_LOCATIONS: ReadonlySet<LocationPref> = new Set<LocationPref>([
  'family_home',
  'tutor_home',
]);

type WeeklyGrid = Partial<Record<DayOfWeek, boolean[]>>;

/** The padded slot range [start, end) a session claims, given its location. */
function paddedBlock(
  startTime: string,
  endTime: string,
  location: LocationPref,
  paddingMinutes: number,
): { start: number; end: number } {
  const startIdx = timeToSlotIndex(startTime);
  const endIdx = timeToSlotIndex(endTime);
  const pad = PADDED_LOCATIONS.has(location)
    ? Math.ceil((paddingMinutes ?? 0) / SLOT_MINUTES)
    : 0;
  return {
    start: Math.max(0, startIdx - pad),
    end: Math.min(SLOTS_PER_DAY, endIdx + pad),
  };
}

/** Half-open ranges [a0,a1) and [b0,b1) overlap. */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/**
 * respondToSession — the tutor confirms or declines a pending session request.
 *
 * CONFIRM is the claim point (the core invariant: "pending is a proposal,
 * confirm is the claim"). It runs in a single transaction — all reads first —
 * that re-checks availability against the CURRENT override + confirmed sessions
 * and, if the padded block is still free, flips the session to `confirmed` and
 * writes a RESTORABLE override ledger: the day's slots with our block AND-ed to
 * false, plus a `sessionBlocks` entry recording exactly what we claimed. The
 * merge preserves any pre-existing override doc's fields and never resurrects a
 * slot it did not itself block (contrast sit's lossy whole-day override).
 */
export const respondToSession = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = respondToSessionSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { sessionId, action } = parsed.data;

    const now = new Date();
    const sessionRef = db.collection('study-sessions').doc(sessionId);

    // ── The claim transaction: all reads before any writes ──
    const outcome = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new HttpsError('not-found', 'Session not found');
      }
      const session = sessionSnap.data()!;
      if (session.tutorUserId !== uid) {
        throw new HttpsError('permission-denied', 'You are not the tutor for this session');
      }
      if (session.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'This session is no longer pending');
      }

      const familyId = session.familyId as string;
      const date = session.date as string;
      const location = session.location as LocationPref;
      const paddingMinutes = (session.paddingMinutes as number) ?? 0;

      // ── Decline: flip status, no override, no schedule mutation ──
      if (action === 'decline') {
        tx.update(sessionRef, {
          status: 'declined',
          statusReason: 'declined_by_tutor',
          updatedAt: now,
        });
        return { familyId, date, action } as const;
      }

      // ── Confirm: re-check notice, recompute availability, claim the block ──
      const startTime = session.startTime as string;
      const endTime = session.endTime as string;

      // Re-check the 24h notice — a pending request can go stale.
      const sessionStart = parisWallTimeToUtc(date, startTime);
      if (sessionStart.getTime() < now.getTime() + NOTICE_HOURS * 60 * 60 * 1000) {
        throw new HttpsError(
          'failed-precondition',
          'This request is too close to the session time',
        );
      }

      // Reads: weekly grid, the current override doc, other confirmed sessions.
      const scheduleRef = db.collection('schedules').doc(uid);
      const overrideRef = scheduleRef.collection('overrides').doc(date);
      const confirmedQuery = db
        .collection('study-sessions')
        .where('tutorUserId', '==', uid)
        .where('status', '==', 'confirmed')
        .where('date', '==', date);

      const [scheduleSnap, overrideSnap, confirmedSnap] = await Promise.all([
        tx.get(scheduleRef),
        tx.get(overrideRef),
        tx.get(confirmedQuery),
      ]);

      const weekly: WeeklyGrid = (scheduleSnap.data()?.weekly as WeeklyGrid) ?? {};
      const dow = dayOfWeek(date);
      const weeklySlots = weekly[dow] ?? [];

      const existing = overrideSnap.exists ? overrideSnap.data()! : null;
      const currentOverride: DayOverride | undefined = existing
        ? {
            type: existing.type as DayOverride['type'],
            slots: existing.slots as boolean[] | undefined,
          }
        : undefined;

      const otherBlocks: ConfirmedBlock[] = confirmedSnap.docs.map((d) => {
        const s = d.data();
        return {
          startIdx: timeToSlotIndex(s.startTime as string),
          endIdx: timeToSlotIndex(s.endTime as string),
          location: s.location as LocationPref,
        };
      });

      // Recompute the day's availability against the CURRENT state.
      const grid = computeDayAvailability({
        date,
        weeklySlots,
        override: currentOverride,
        confirmedBlocks: otherBlocks,
        paddingMin: paddingMinutes,
        nowParis: parisWallClockPosition(now),
        noticeHours: NOTICE_HOURS,
      });

      // The raw session slots must all still be free.
      const rawStart = timeToSlotIndex(startTime);
      const rawEnd = timeToSlotIndex(endTime);
      for (let i = rawStart; i < rawEnd; i++) {
        if (!grid[i]) {
          throw new HttpsError('failed-precondition', 'This time is no longer available');
        }
      }

      // ── Build the restorable override (read-modify-write) ──
      const block = paddedBlock(startTime, endTime, location, paddingMinutes);

      // Base = existing override's slots, else all-false for an 'unavailable'
      // day, else the weekly grid. We only ever AND our block to false — never
      // resurrect a slot we did not block.
      let baseSlots: boolean[];
      if (existing?.slots) {
        baseSlots = [...(existing.slots as boolean[])];
      } else if (existing?.type === 'unavailable') {
        baseSlots = new Array(SLOTS_PER_DAY).fill(false);
      } else {
        baseSlots = new Array(SLOTS_PER_DAY);
        for (let i = 0; i < SLOTS_PER_DAY; i++) baseSlots[i] = weeklySlots[i] ?? false;
      }
      for (let i = block.start; i < block.end; i++) baseSlots[i] = false;

      const priorBlocks = Array.isArray(existing?.sessionBlocks)
        ? (existing!.sessionBlocks as unknown[])
        : [];
      const sessionBlocks = [
        ...priorBlocks,
        { sessionId, startIdx: block.start, endIdx: block.end },
      ];

      // Preserve every field of a pre-existing (opaque) override; only fill
      // appSource/reason/type when they are absent, so a foreign override keeps
      // its own identity while gaining our restorable ledger entry.
      const mergedOverride: Record<string, unknown> = {
        ...(existing ?? {}),
        date,
        type: existing?.type ?? 'custom',
        slots: baseSlots,
        sessionBlocks,
        appSource: existing?.appSource ?? 'study',
        reason: existing?.reason ?? 'study_session',
        updatedAt: now,
      };
      if (!existing) mergedOverride.createdAt = now;

      tx.update(sessionRef, { status: 'confirmed', confirmedAt: now, updatedAt: now });
      tx.set(overrideRef, mergedOverride);

      return { familyId, date, action, block } as const;
    });

    // ── POST-transaction: auto-decline overlapping pendings (confirm only) ──
    const autoDeclined: { sessionId: string; familyId: string }[] = [];
    if (outcome.action === 'confirm' && outcome.block) {
      const pendingSnap = await db
        .collection('study-sessions')
        .where('tutorUserId', '==', uid)
        .where('status', '==', 'pending')
        .where('date', '==', outcome.date)
        .get();
      for (const doc of pendingSnap.docs) {
        if (doc.id === sessionId) continue; // the just-confirmed one is no longer pending, but guard anyway
        const p = doc.data();
        const pb = paddedBlock(
          p.startTime as string,
          p.endTime as string,
          p.location as LocationPref,
          (p.paddingMinutes as number) ?? 0,
        );
        if (!overlaps(outcome.block.start, outcome.block.end, pb.start, pb.end)) continue;
        await doc.ref.update({
          status: 'declined',
          statusReason: 'slot_taken',
          updatedAt: new Date(),
        });
        autoDeclined.push({ sessionId: doc.id, familyId: p.familyId as string });
      }
    }

    // ── Notifications ──
    const tutorDoc = await db.collection('users').doc(uid).get();
    const tutorUser = tutorDoc.data();
    const tutorName = `${tutorUser?.firstName || ''} ${tutorUser?.lastName || ''}`.trim() || 'Your tutor';

    // Each auto-declined family (their slot got taken).
    for (const ad of autoDeclined) {
      await notifyAllParents({
        familyId: ad.familyId,
        prefCategory: 'cancelled',
        type: 'study_session_declined',
        title: 'Session no longer available',
        body: `That time with ${tutorName} was just booked by another family.`,
        emailSubject: `Session time no longer available — ${tutorName}`,
        emailBody: `
          <p>The time you requested with <strong>${tutorName}</strong> is no longer available — it was just booked.</p>
          <p>You can request another time.</p>
          <p style="margin-top: 16px;"><a href="https://sync-study.com/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { sessionId: ad.sessionId },
      });
      await writeUserActivity(uid, 'session_auto_declined', { sessionId: ad.sessionId });
    }

    // The requesting family (confirmed on confirm, cancelled on decline).
    if (outcome.action === 'confirm') {
      await notifyAllParents({
        familyId: outcome.familyId,
        prefCategory: 'confirmed',
        type: 'study_session_confirmed',
        title: 'Session confirmed',
        body: `${tutorName} confirmed your tutoring session.`,
        emailSubject: `Session confirmed — ${tutorName}`,
        emailBody: `
          <p><strong>${tutorName}</strong> confirmed your tutoring session.</p>
          <p style="margin-top: 16px;"><a href="https://sync-study.com/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { sessionId },
      });
    } else {
      await notifyAllParents({
        familyId: outcome.familyId,
        prefCategory: 'cancelled',
        type: 'study_session_declined',
        title: 'Session declined',
        body: `${tutorName} declined your tutoring session request.`,
        emailSubject: `Session declined — ${tutorName}`,
        emailBody: `
          <p><strong>${tutorName}</strong> declined your tutoring session request.</p>
          <p>You can request another time or another tutor.</p>
          <p style="margin-top: 16px;"><a href="https://sync-study.com/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { sessionId },
      });
    }

    await writeUserActivity(
      uid,
      outcome.action === 'confirm' ? 'session_confirmed' : 'session_declined',
      { sessionId },
    );

    return { success: true };
  },
);
