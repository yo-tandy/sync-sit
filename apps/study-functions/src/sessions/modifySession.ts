import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { Transaction, DocumentReference } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { parisWallClockPosition, parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
import { timeToSlotIndex, slotIndexToTime, getParentProfile } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import {
  getSchoolYearsInRange,
  dayOfWeek,
  resolveEffectiveLocations,
  type DayOverride,
} from '@ejm/study-core';
import { computeSingleDateAvailability } from '../availability/singleDateAvailability.js';
import { modifySessionSchema, type ModifySessionInput } from '../validation/session.js';
import {
  computeDateAvailability,
  sessionToConfirmedBlock,
  type WeeklyGrid,
  type HolidayPeriod,
} from '../availability/computeDateAvailability.js';
import {
  paddedBlock,
  overlaps,
  buildMergedOverride,
  buildRestoredOverride,
  type RestoreResult,
} from './sessionOverride.js';

const NOTICE_HOURS = 24;

/** Apply a restoration result to an override ref inside the transaction (cancelSession idiom). */
function applyRestore(tx: Transaction, ref: DocumentReference, result: RestoreResult): void {
  if (result.action === 'delete') tx.delete(ref);
  else if (result.action === 'set') tx.set(ref, result.doc);
}

/**
 * modifySession (issue #234, parity A1): the FAMILY changes a one_time
 * session's when/where/who without cancelling it; the TUTOR is notified and
 * acknowledges (acknowledgeSessionModification) — sit's
 * modifyAppointment/acknowledgeModification contract, adapted to study's
 * availability ledger.
 *
 * Scope decisions (plan doc, docs/superpowers/plans/2026-08-27-…):
 * - one_time only: a recurring series is regenerated instances +
 *   per-occurrence claims; mutating it in place is its own feature
 *   (`reason: 'recurring_unsupported'` → the client says cancel-and-rebook).
 * - `date` IS modifiable (unlike sit — moving the day is THE reschedule);
 *   `rate` is NOT (study's rate is the tutor's locked-in offering).
 * - A tutor-proposed PENDING is not modifiable by the family — that is a
 *   counter-offer; they accept or decline (`reason: 'proposal_not_modifiable'`).
 * - NEVER touches lateCancellation: a modify is not a cancel. That is the
 *   entire point of this callable existing (flows doc §6).
 *
 * The hard case is a claim-affecting change (date/time/length/location — the
 * padded block depends on all four) on a CONFIRMED session: in ONE
 * transaction the old claim is restored (buildRestoredOverride), the new time
 * is re-checked against current availability, and the new claim merged in —
 * so two racing modifies, or a modify racing a booking, cannot double-claim.
 */
export const modifySession = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = modifySessionSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const data: ModifySessionInput = parsed.data;
    const { sessionId } = data;
    if (
      data.date === undefined &&
      data.startTime === undefined &&
      data.sessionLengthMinutes === undefined &&
      data.location === undefined &&
      data.studentIds === undefined &&
      data.message === undefined
    ) {
      throw new HttpsError('invalid-argument', 'Nothing to modify');
    }

    const now = new Date();
    const sessionRef = db.collection('study-sessions').doc(sessionId);

    // ── Load session + caller OUTSIDE the transaction (cancelSession idiom);
    // the transaction re-reads the session authoritatively. ──
    const [sessionSnap, callerDoc] = await Promise.all([
      sessionRef.get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', 'Session not found');
    }
    const peek = sessionSnap.data()!;

    const callerParent = getParentProfile(callerDoc.data() as User | undefined);
    if (!callerParent?.familyId || callerParent.familyId !== peek.familyId) {
      throw new HttpsError('permission-denied', 'Only a parent of this family can modify the session');
    }
    if (peek.status !== 'pending' && peek.status !== 'confirmed') {
      throw new HttpsError('failed-precondition', 'Only a pending or confirmed session can be modified');
    }
    if (peek.type !== 'one_time') {
      throw new HttpsError(
        'failed-precondition',
        'A recurring series cannot be modified in place — cancel it and book again',
        { reason: 'recurring_unsupported' },
      );
    }
    if (peek.proposedBy === 'provider' && peek.status === 'pending') {
      throw new HttpsError(
        'failed-precondition',
        "This is the tutor's proposal — accept or decline it instead",
        { reason: 'proposal_not_modifiable' },
      );
    }

    const tutorUserId = peek.tutorUserId as string;
    const paddingMinutes = (peek.paddingMinutes as number) ?? 0;

    // ── Re-denormalize students when the roster changes (respondToSession's
    // provider-confirm idiom): the kids must belong to THIS family. ──
    let studentDenorm: { studentIds: string[]; students: { firstName: string; age: number }[] } | null = null;
    if (data.studentIds !== undefined) {
      const students: { firstName: string; age: number }[] = [];
      for (const kidId of data.studentIds) {
        const snap = await db
          .collection('families')
          .doc(peek.familyId as string)
          .collection('kids')
          .doc(kidId)
          .get();
        if (!snap.exists) {
          throw new HttpsError('not-found', 'One or more selected students were not found');
        }
        const kid = snap.data()!;
        students.push({ firstName: (kid.firstName as string) ?? '', age: (kid.age as number) ?? 0 });
      }
      studentDenorm = { studentIds: data.studentIds, students };
    }

    // ── Pre-load static availability config OUTSIDE the transaction
    // (respondToSession's reasoning verbatim: weekly/holiday config is static
    // per-tutor state, not the contended claim; the override + confirmed reads
    // that gate the claim are transactional below). ──
    const newDatePeek = data.date ?? (peek.date as string);
    const scheduleRef = db.collection('schedules').doc(tutorUserId);
    const scheduleSnap = await scheduleRef.get();
    const scheduleData = scheduleSnap.data();
    const weekly: WeeklyGrid = (scheduleData?.weekly as WeeklyGrid) ?? {};
    const holidayMode = scheduleData?.holidayMode as string | undefined;
    const holidaySchedules = scheduleData?.holidaySchedules as Record<string, WeeklyGrid> | undefined;
    const holidayPeriods: HolidayPeriod[] = [];
    if (holidayMode === 'different') {
      const years = getSchoolYearsInRange(newDatePeek, newDatePeek);
      const holidaySnaps = await Promise.all(years.map((y) => db.collection('holidays').doc(y).get()));
      for (const snap of holidaySnaps) {
        const p = snap.data()?.periods as HolidayPeriod[] | undefined;
        if (p) holidayPeriods.push(...p);
      }
    }

    // ── The when/where trust boundary, OUTSIDE the transaction ──
    // Location tags and the tutor's prefs are tutor-set config, not the
    // contended claim state (claims never change tags), so this mirrors
    // bookSession's checks at the same trust level. modifySession is a
    // directly-callable endpoint: the family UI not sending `location` does
    // not constrain a caller (PR #244 review; issue #166's boundary).
    const newStartPeek = data.startTime ?? (peek.startTime as string);
    const newLengthPeek = (data.sessionLengthMinutes ?? peek.sessionLengthMinutes) as number;
    const newLocationPeek = (data.location ?? peek.location) as LocationPref;
    const whenChanged =
      data.date !== undefined ||
      data.startTime !== undefined ||
      data.sessionLengthMinutes !== undefined ||
      data.location !== undefined;
    if (whenChanged) {
      const startIdxPeek = timeToSlotIndex(newStartPeek);
      const endIdxPeek = startIdxPeek + newLengthPeek / 15;
      if (endIdxPeek > 96) {
        // bookSession's guard verbatim: without it a 23:45 + 75min modify
        // writes endTime '25:00' and the session becomes permanently
        // unconfirmable (the confirm grid check reads grid[96..] === undefined).
        throw new HttpsError('invalid-argument', 'Session cannot run past midnight');
      }
      const tutorProfileDoc = await db.collection('users').doc(tutorUserId).get();
      const tutorProfile = (tutorProfileDoc.data()?.profiles as
        | { tutor?: { locationPrefs?: LocationPref[] } }
        | undefined)?.tutor;
      const single = await computeSingleDateAvailability(tutorUserId, newDatePeek, paddingMinutes);
      const effective = resolveEffectiveLocations(
        single.locationCells,
        startIdxPeek,
        endIdxPeek,
        tutorProfile?.locationPrefs ?? [],
      );
      if (!effective.includes(newLocationPeek)) {
        throw new HttpsError(
          'invalid-argument',
          'Tutor does not offer this location for this time slot',
          { reason: 'location_not_offered' },
        );
      }
      // Pending availability pre-check (bookSession parity). The CONFIRMED
      // path re-checks transactionally against the restored ledger below --
      // this grid still counts the session's own old claim, so it would
      // false-refuse a confirmed same-day move.
      if (peek.status === 'pending') {
        for (let i = startIdxPeek; i < endIdxPeek; i++) {
          if (!single.slots[i]) {
            throw new HttpsError('failed-precondition', 'The new time is not available', {
              reason: 'time_unavailable',
            });
          }
        }
      }
    }

    // ── The modify transaction: all reads before any writes. ──
    const outcome = await db.runTransaction(async (tx) => {
      const authSnap = await tx.get(sessionRef);
      if (!authSnap.exists) {
        throw new HttpsError('not-found', 'Session not found');
      }
      const session = authSnap.data()!;
      // Re-check everything the peek checked — it can have moved under us.
      if (session.status !== 'pending' && session.status !== 'confirmed') {
        throw new HttpsError('failed-precondition', 'Only a pending or confirmed session can be modified');
      }
      if (session.type !== 'one_time') {
        throw new HttpsError('failed-precondition', 'A recurring series cannot be modified in place — cancel it and book again', { reason: 'recurring_unsupported' });
      }

      const oldDate = session.date as string;
      const oldStart = session.startTime as string;
      const oldEnd = session.endTime as string;
      const oldLocation = session.location as LocationPref;
      const oldLength = session.sessionLengthMinutes as number;

      const newDate = data.date ?? oldDate;
      const newStart = data.startTime ?? oldStart;
      const newLength = data.sessionLengthMinutes ?? oldLength;
      const newLocation = data.location ?? oldLocation;
      const startIdx = timeToSlotIndex(newStart);
      const endIdx = startIdx + newLength / 15;
      const newEnd = slotIndexToTime(endIdx);

      // ── Diff → modifiedFields (sit's contract: no-op returns modified:false) ──
      const modifiedFields: string[] = [];
      if (newDate !== oldDate) modifiedFields.push('date');
      if (newStart !== oldStart) modifiedFields.push('startTime');
      if (newLength !== oldLength) modifiedFields.push('sessionLengthMinutes');
      if (newLocation !== oldLocation) modifiedFields.push('location');
      if (
        studentDenorm &&
        JSON.stringify([...studentDenorm.studentIds].sort()) !==
          JSON.stringify([...((session.studentIds as string[]) ?? [])].sort())
      ) {
        modifiedFields.push('students');
      }
      if (data.message !== undefined && data.message !== ((session.message as string) ?? '')) {
        modifiedFields.push('message');
      }
      if (modifiedFields.length === 0) {
        return { modified: false as const };
      }

      // The padded block depends on date, time, length AND location (location
      // drives travel/prep padding), so any of them moves the claim.
      const claimAffecting =
        modifiedFields.includes('date') ||
        modifiedFields.includes('startTime') ||
        modifiedFields.includes('sessionLengthMinutes') ||
        modifiedFields.includes('location');

      // A moved session must still respect the notice window, and a session
      // whose CURRENT start already passed is history, not modifiable.
      if (claimAffecting) {
        const currentStart = parisWallTimeToUtc(oldDate, oldStart);
        if (currentStart.getTime() < now.getTime()) {
          throw new HttpsError('failed-precondition', 'This session has already started');
        }
        const sessionStart = parisWallTimeToUtc(newDate, newStart);
        if (sessionStart.getTime() < now.getTime() + NOTICE_HOURS * 60 * 60 * 1000) {
          throw new HttpsError(
            'failed-precondition',
            'The new time is too close — sessions need 24 hours notice',
            { reason: 'time_unavailable' },
          );
        }
      }

      const updates: Record<string, unknown> = {
        modified: true,
        modifiedAt: now,
        modifiedFields,
        updatedAt: now,
      };
      if (modifiedFields.includes('date')) updates.date = newDate;
      if (modifiedFields.includes('startTime') || modifiedFields.includes('sessionLengthMinutes')) {
        updates.startTime = newStart;
        updates.endTime = newEnd;
        updates.sessionLengthMinutes = newLength;
      }
      if (modifiedFields.includes('location')) updates.location = newLocation;
      if (modifiedFields.includes('students') && studentDenorm) {
        updates.studentIds = studentDenorm.studentIds;
        updates.students = studentDenorm.students;
      }
      if (modifiedFields.includes('message')) updates.message = data.message;

      // ── Pending: no claim exists yet, AND no modified flag -- the tutor
      // answers the UPDATED request, so their confirm/decline IS the
      // acknowledgement. A flag here would have no surface to clear it from
      // (the pending card is Confirm/Decline) and would resurface post-confirm
      // as a badge for a change the tutor already saw (PR #244 review). ──
      if (session.status === 'pending') {
        delete updates.modified;
        delete updates.modifiedAt;
        // modifiedFields still returns to the caller; only the flag is elided.
        delete updates.modifiedFields;
        tx.update(sessionRef, updates);
        return {
          modified: true as const,
          modifiedFields,
          status: session.status as string,
          movedClaim: false as const,
          newDate,
          newStart,
          newEnd,
          newLocation,
        };
      }
      if (!claimAffecting) {
        tx.update(sessionRef, updates);
        return {
          modified: true as const,
          modifiedFields,
          status: session.status as string,
          movedClaim: false as const,
          newDate,
          newStart,
          newEnd,
          newLocation,
        };
      }

      // ── Confirmed + claim-affecting: restore old claim, re-check, claim new. ──
      const oldOverrideRef = scheduleRef.collection('overrides').doc(oldDate);
      const newOverrideRef = scheduleRef.collection('overrides').doc(newDate);
      const sameDate = newDate === oldDate;
      const confirmedQuery = db
        .collection('study-sessions')
        .where('tutorUserId', '==', tutorUserId)
        .where('status', '==', 'confirmed')
        .where('date', '==', newDate);
      const [oldOverrideSnap, newOverrideSnap, confirmedSnap] = await Promise.all([
        tx.get(oldOverrideRef),
        sameDate ? Promise.resolve(null) : tx.get(newOverrideRef),
        tx.get(confirmedQuery),
      ]);

      const oldExisting = oldOverrideSnap.exists ? oldOverrideSnap.data()! : null;
      const restore = buildRestoredOverride({
        existing: oldExisting,
        sessionId,
        weeklySlots: weekly[dayOfWeek(oldDate)] ?? [],
        now,
      });

      // The doc state the NEW claim merges into: on the same date, the
      // RESTORED doc (so our own old block does not shadow the re-check);
      // on a different date, that date's current override.
      const mergeBase =
        sameDate
          ? restore.action === 'set'
            ? (restore.doc as Record<string, unknown>)
            : restore.action === 'delete'
              ? null
              : oldExisting
          : newOverrideSnap && newOverrideSnap.exists
            ? newOverrideSnap.data()!
            : null;

      const currentOverride: DayOverride | undefined = mergeBase
        ? { type: mergeBase.type as DayOverride['type'], slots: mergeBase.slots as boolean[] | undefined }
        : undefined;

      // Every OTHER confirmed session on the new date blocks us; this one
      // does not block itself.
      const otherBlocks = confirmedSnap.docs
        .filter((d) => d.id !== sessionId)
        .map((d) => {
          const s = d.data();
          return sessionToConfirmedBlock({
            startTime: s.startTime as string,
            endTime: s.endTime as string,
            location: s.location as LocationPref,
          });
        });

      const grid = computeDateAvailability(
        newDate,
        {
          weekly,
          holidayMode,
          holidaySchedules,
          holidayPeriods,
          override: currentOverride,
          confirmedBlocks: otherBlocks,
          paddingMin: paddingMinutes,
        },
        parisWallClockPosition(now),
        NOTICE_HOURS,
      );
      for (let i = startIdx; i < endIdx; i++) {
        if (!grid[i]) {
          throw new HttpsError('failed-precondition', 'The new time is not available', {
            reason: 'time_unavailable',
          });
        }
      }

      const block = paddedBlock(newStart, newEnd, newLocation, paddingMinutes);
      const merged = buildMergedOverride({
        existing: mergeBase,
        date: newDate,
        weeklySlots: weekly[dayOfWeek(newDate)] ?? [],
        block,
        entry: { sessionId, startIdx: block.start, endIdx: block.end },
        now,
      });

      if (sameDate) {
        tx.set(oldOverrideRef, merged);
      } else {
        applyRestore(tx, oldOverrideRef, restore);
        tx.set(newOverrideRef, merged);
      }
      tx.update(sessionRef, updates);
      return {
        modified: true as const,
        modifiedFields,
        status: 'confirmed' as const,
        movedClaim: true as const,
        newDate,
        newStart,
        newEnd,
        newLocation,
        block,
      };
    });

    if (!outcome.modified) {
      return { success: true, modified: false };
    }

    // ── POST-transaction: auto-decline overlapping one_time pendings at the
    // NEW time (respondToSession's post-confirm sweep, same statusReason). ──
    const autoDeclined: { sessionId: string; familyId: string }[] = [];
    if (outcome.movedClaim && outcome.block) {
      const pendingSnap = await db
        .collection('study-sessions')
        .where('tutorUserId', '==', tutorUserId)
        .where('status', '==', 'pending')
        .where('date', '==', outcome.newDate)
        .get();
      for (const doc of pendingSnap.docs) {
        if (doc.id === sessionId) continue;
        const p = doc.data();
        if (p.type !== 'one_time') continue;
        const pb = paddedBlock(
          p.startTime as string,
          p.endTime as string,
          p.location as LocationPref,
          (p.paddingMinutes as number) ?? 0,
        );
        if (!overlaps(outcome.block.start, outcome.block.end, pb.start, pb.end)) continue;
        await doc.ref.update({ status: 'declined', statusReason: 'slot_taken', updatedAt: new Date() });
        autoDeclined.push({ sessionId: doc.id, familyId: p.familyId as string });
      }
    }

    await writeUserActivity(uid, 'session_modified', {
      sessionId,
      modifiedFields: outcome.modifiedFields,
      movedClaim: outcome.movedClaim,
    });

    // ── Notify the tutor (sit's modifyAppointment shape, study branding). ──
    const tutorDoc = await db.collection('users').doc(tutorUserId).get();
    const tutorUser = tutorDoc.data();
    const familyName = (peek.familyName as string) || 'A family';
    const dateInfo = `${outcome.newDate}, ${outcome.newStart}–${outcome.newEnd}`;
    const changed = outcome.modifiedFields.join(', ');
    const prefs = tutorUser?.notifPrefs?.newRequest;
    let emailSent = false;
    if (prefs?.email !== false && tutorUser?.email) {
      emailSent = await sendNotificationEmail(
        tutorUser.email,
        `Session modified by ${familyName}`,
        `<p><strong>${escapeHtml(familyName)}</strong> has modified your session — now <strong>${escapeHtml(dateInfo)}</strong>.</p>
         <p><strong>Changes:</strong> ${escapeHtml(changed)}</p>
         <p style="color: #6B7280; font-size: 14px;">Please review and acknowledge the changes in the app.</p>
         <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor/sessions" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Changes</a></p>`,
        'study',
      );
    }
    let pushSent = false;
    if (prefs?.push !== false) {
      pushSent = await sendPushNotification(
        tutorUserId,
        'Session modified',
        `${familyName} modified your session — now ${dateInfo}.`,
        { sessionId, type: 'study_session_modified' },
        'study',
      );
    }
    await db.collection('notifications').add({
      recipientUserId: tutorUserId,
      type: 'study_session_modified',
      title: 'Session modified',
      body: `${familyName} modified your session — now ${dateInfo}. Changed: ${changed}`,
      data: { sessionId },
      read: false,
      channels: ['email', 'push'],
      emailSent,
      pushSent,
      createdAt: now,
    });

    // Families whose pending was displaced by the move (sweep above).
    const tutorName = `${tutorUser?.firstName || ''} ${tutorUser?.lastName || ''}`.trim() || 'Your tutor';
    for (const ad of autoDeclined) {
      await notifyAllParents({
        familyId: ad.familyId,
        prefCategory: 'cancelled',
        app: 'study',
        type: 'study_session_declined',
        title: 'Session no longer available',
        body: `That time with ${tutorName} is no longer available.`,
        emailSubject: `Session time no longer available — ${tutorName}`,
        emailBody: `<p>That requested time with <strong>${escapeHtml(tutorName)}</strong> is no longer available.</p>
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family/sessions" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
        data: { sessionId: ad.sessionId },
      });
    }

    return { success: true, modified: true, modifiedFields: outcome.modifiedFields };
  },
);
