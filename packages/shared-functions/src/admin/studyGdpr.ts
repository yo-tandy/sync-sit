import { FieldValue } from 'firebase-admin/firestore';
import { parisDateString } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import {
  createClaimReleaser,
  STUDY_PROVENANCE,
} from '../schedule/claimRelease.js';
import type { SessionBlockEntry } from '../schedule/sessionOverride.js';

/**
 * The sync-study halves of `exportUserData` and `deleteUser` (issue #408 item 1).
 *
 * `deleteUser` never touched `study-sessions` at all — not to delete, not to
 * anonymize — so an erased tutor's sessions kept their `tutorName` and an
 * erased family's kept `familyName`, `parentName`, the `students[]` roster
 * (each child's first name and age) and the family's home `address`/`latLng`.
 * `exportUserData` had the mirror hole: a tutor's or a family's entire
 * engagement history was absent from a subject-access request. This module
 * holds both directions, for the same reason `doGdpr.ts` does: export and
 * erasure need the SAME queries in mirror image, and the cascade has three
 * moving parts (the parent doc, the `instances` subcollection, and the tutor's
 * schedule claims) that would otherwise be copied into two files.
 *
 * Deliberately string-keyed with no `@ejm/study-core` import, following
 * `referenceKeys.ts` and `doGdpr.ts`: `@ejm/shared-functions` does not depend on
 * the leaf app packages, so the field names below are `SessionDoc` /
 * `SessionInstanceDoc` as shipped, with the contract stated here.
 */

/** `study-sessions/{sessionId}` — the tutoring engagement (sit's `appointments`). */
export const STUDY_SESSIONS_COLLECTION = 'study-sessions';
/** `study-sessions/{sessionId}/instances/{YYYY-MM-DD}` — a recurring occurrence. */
export const STUDY_INSTANCES_SUBCOLLECTION = 'instances';

/** The anonymized-uid sentinel every erasure path in `deleteUser` writes. */
const DELETED = 'deleted';

/** Firestore's write-batch ceiling, with the same headroom `doGdpr` takes. */
const BATCH_CHUNK = 400;

/** Concurrency bound on the export's per-session subcollection reads. Same
 *  number as the write chunk so both halves of this module scale alike. */
const READ_CHUNK = BATCH_CHUNK;

export interface StudySessionExport extends Record<string, unknown> {
  id: string;
  /** The `instances` subcollection, inlined — Firestore never returns it with
   *  the parent, so an export that omitted it would drop every occurrence of a
   *  recurring series (with its per-occurrence notes). */
  instances: Record<string, unknown>[];
}

/**
 * Collect one user's study sessions for `exportUserData`, BOTH sides:
 *
 * - the TUTOR side (`tutorUserId`) — the engagement is about them, and the doc
 *   carries their `tutorName` and their `postSessionNote` free text;
 * - the FAMILY side (`familyId`) — the same reasoning that already gives a
 *   parent their family's appointments and their family's endorsements: a
 *   session is family data and either parent may have booked it. It carries the
 *   family's `students[]` roster, `address` and `preSessionNote` (and, on a
 *   family-initiated booking, `message`).
 *
 * Deduplicated by doc id. Both queries are single-field equality, served by the
 * automatic single-field indexes — no composite is required (and none exists
 * for `tutorUserId` alone; `firestore.indexes.json`'s `study-sessions`
 * composites are all `(x, status, date)` shapes for the portals).
 */
export async function collectStudySessions(
  targetUserId: string,
  familyId: string | null,
): Promise<StudySessionExport[]> {
  const empty = { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
  const [tutorSnap, familySnap] = await Promise.all([
    db
      .collection(STUDY_SESSIONS_COLLECTION)
      .where('tutorUserId', '==', targetUserId)
      .get(),
    familyId
      ? db.collection(STUDY_SESSIONS_COLLECTION).where('familyId', '==', familyId).get()
      : Promise.resolve(empty as any),
  ]);

  const sessionDocs = Array.from(
    new Map(
      [...tutorSnap.docs, ...(familySnap as any).docs].map((doc: any) => [doc.id, doc]),
    ).values(),
  ) as FirebaseFirestore.QueryDocumentSnapshot[];

  // Bounded fan-out. One subcollection read per session, but issued in chunks
  // rather than all at once: the erasure half of this module explicitly budgets
  // for "a long-lived tutor can hold arbitrarily many sessions", and an
  // unbounded `Promise.all` over that same set would give the export a cost
  // profile the erasure deliberately avoids. `READ_CHUNK` mirrors the write
  // chunk so both halves scale the same way.
  const out: StudySessionExport[] = [];
  for (let i = 0; i < sessionDocs.length; i += READ_CHUNK) {
    const page = await Promise.all(
      sessionDocs.slice(i, i + READ_CHUNK).map(async (doc) => {
        const instancesSnap = await doc.ref.collection(STUDY_INSTANCES_SUBCOLLECTION).get();
        return {
          id: doc.id,
          ...doc.data(),
          instances: instancesSnap.docs.map((inst) => ({ id: inst.id, ...inst.data() })),
        };
      }),
    );
    out.push(...page);
  }
  return out;
}

export interface ScheduleExport extends Record<string, unknown> {
  id: string;
  /** `schedules/{uid}/overrides/{YYYY-MM-DD}` — per-date availability plus the
   *  `sessionBlocks` claim ledger naming the engagements that blocked them. */
  overrides: Record<string, unknown>[];
}

/**
 * Collect `schedules/{uid}` and its `overrides` subcollection for
 * `exportUserData`.
 *
 * The asymmetry this closes: `deleteUser` has ERASED this document since the
 * very first version of the callable — it is recognised as the subject's own
 * personal data (their weekly availability grid, every date they marked
 * unavailable, and the ledger of engagements that claimed their slots) — yet
 * the export has never returned it. A collection that erasure covers and export
 * does not is precisely the blind spot the `references` gap (PR #311) was.
 */
export async function collectScheduleData(
  targetUserId: string,
): Promise<ScheduleExport | null> {
  const scheduleRef = db.collection('schedules').doc(targetUserId);
  const [snap, overridesSnap] = await Promise.all([
    scheduleRef.get(),
    scheduleRef.collection('overrides').get(),
  ]);
  if (!snap.exists && overridesSnap.empty) return null;
  return {
    id: scheduleRef.id,
    ...(snap.data() ?? {}),
    overrides: overridesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

export interface StudyEraseStats {
  /** Sessions whose tutor-side or family-side identity fields were anonymized. */
  sessionsAnonymized: number;
  /** Pending/confirmed sessions force-cancelled by the erasure. */
  sessionsCancelled: number;
  /** Future `scheduled` occurrences cancelled alongside their series. */
  instancesCancelled: number;
  /** Occurrences that lost a pre- or post-session note. Independent of
   *  `instancesCancelled`: an occurrence can be counted in both. */
  instancesScrubbed: number;
  /** Tutor `sessionBlocks` claims released back to a SURVIVING tutor. */
  claimsReleased: number;
  /** Per-session cascades that failed and were skipped (poison-pill isolation). */
  cascadeErrors: number;
}

/** Chunked commit — a long-lived tutor can hold arbitrarily many sessions and
 *  `deleteUser`'s own batches have no 500-op guard. */
async function commitChunked(
  writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[],
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_CHUNK) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_CHUNK)) batch.update(w.ref, w.data);
    await batch.commit();
  }
}

/**
 * Erase one user's study-session data for `deleteUser`. Call it BEFORE the user
 * document is deleted, with the same `familyId` / `isLastParent` the
 * appointment, family and reference steps computed.
 *
 * ── WHY ANONYMIZE RATHER THAN DELETE ──
 *
 * PR #311 deleted `references` docs outright from either side, and argued it
 * field by field: strip a reference of its submitter-side and provider-side
 * personal data and NOTHING substantive is left — `type`, `status` and two
 * timestamps, a contentless ghost every reader would have to special-case. The
 * same field-by-field pass over a session reaches the OPPOSITE conclusion, and
 * that is the point of doing the pass rather than copying the verdict:
 *
 *   - `date`/`startTime`/`endTime`, `subject`/`level`, `rate`, `status`,
 *     `cancellationNoticeHours`, `lateCancellation` and the timestamps are the
 *     surviving counterparty's OWN engagement history — what they taught or
 *     bought, when, at what price, and whether it was cancelled late. A tutor
 *     erasing their account cannot take the family's record of the sessions
 *     they paid for with them, any more than a deleted babysitter takes the
 *     family's appointment history (the live sit precedent: anonymize the uid,
 *     hard-erase the deleted party's free text, KEEP the doc).
 *   - So the residue is real, and the treatment is the sit appointment one,
 *     applied to study's larger denormalization surface.
 *
 * ── WHAT ERASURE MEANS PER FIELD ──
 *
 * TUTOR erased (`tutorUserId == uid`; the family survives):
 *   - `tutorUserId` → 'deleted' (the sit `babysitterUserId` sentinel).
 *   - `tutorName` → '' — a denormalized snapshot of the erased person's name,
 *     kept on the doc only because a family cannot read a tutor doc. sit's
 *     appointments carry no counterpart field, so this half has no precedent to
 *     copy, and '' is what the identity fan-out already writes for an unknown
 *     name. What the family portal then RENDERS is a blank, not a fallback
 *     label: `SessionsPage.tsx` interpolates `{s.tutorName}` raw at :658 and
 *     :952 (and into the endorse/proposed-by strings at :617/:863). That is
 *     acceptable — the alternative is retaining an erased person's name — but
 *     it is a blank, and saying otherwise would let the next reader take
 *     unverified UI behaviour as verified. A `deletedAt` tombstone letting the
 *     UI say "former tutor" is the real fix; see the PR's follow-ups.
 *   - `postSessionNote` (and every instance's) → deleted. TUTOR-authored free
 *     text, the exact analogue of the `postAppointmentNote` erasure issue #238
 *     added to the sit half: erased immediately with the account rather than
 *     left to a redaction cron.
 *   - `pending`/`confirmed` → cancelled, `statusReason: 'account_deleted'`.
 *     There is no tutor left to teach it.
 *
 * EITHER SIDE:
 *   - `createdByUserId` / `parentUserId` → 'deleted' when they name the erased
 *     user. ALWAYS — co-parent surviving or not, and tutor side as well as
 *     family side, because on a `proposedBy: 'provider'` doc `createdByUserId`
 *     IS the tutor. Same rule and same reason as the appointment
 *     `createdByUserId` anonymization: without it a deleted party's uid lingers
 *     on docs the surviving party still owns.
 *   - `message` → deleted, keyed on WHO WROTE IT: the tutor on a
 *     `proposedBy: 'provider'` proposal, the family on every other booking.
 *     Authorship decides every other free-text field here, so it decides this
 *     one.
 *
 * FAMILY erased:
 *   - Everything FAMILY-level — `familyName`, `parentName`, `students[]` and
 *     `studentIds`, `address`/`latLng`, `preSessionNote` (and every instance's
 *     `preSessionNote`) — goes ONLY when the LAST parent goes. This
 *     is exactly the `preAppointmentNote` rule: the note, the roster and the
 *     address are family data, not per-parent data; while a co-parent survives
 *     they stay theirs to manage, and when the family itself is deleted they go
 *     with it. `students[]` is the sharpest of them — each child's first name
 *     and age, denormalized so the tutor can render the roster, and with the
 *     `kids` subcollection deleted in step 4 this is the last copy.
 *   - `pending`/`confirmed` → cancelled on the LAST parent only, `statusReason:
 *     'account_deleted'` — while a co-parent survives the family still exists
 *     and can honour them, again the appointment rule verbatim.
 *
 * ── THE SCHEDULE CLAIM ──
 *
 * A cancel here must release the tutor's `sessionBlocks` claim, or the erasure
 * leaves the SURVIVING tutor with a slot blocked forever by a session that will
 * never happen — the same dangling-claim class as issue #408 item 4, minted
 * fresh. It uses `createClaimReleaser`, the ONE shared lossless inverse
 * (`buildRestoredOverride`) every cancel path and both retention sweeps use, so
 * a cross-app sit claim on the same date is conserved.
 *
 * Ordering: the document is cancelled FIRST and the claim released after, which
 * is `cancelAppointment`/`cancelSession`'s own order and the right one here. A
 * failed release then leaves a blocked slot on an already-cancelled session
 * (benign, and exactly today's behaviour); the reverse order would reopen a slot
 * on a session still marked confirmed, which is a double-booking. The retention
 * sweeps release first because THEY delete the document and would otherwise
 * strand a ledger entry naming nothing — a different failure mode.
 *
 * When the TUTOR is the erased user their whole `schedules/{uid}` document and
 * `overrides` subcollection are deleted by `deleteUser` step 3, so their claims
 * go wholesale and the releaser's existence probe simply finds nothing.
 */
export async function eraseStudyUserData(
  targetUserId: string,
  familyId: string | null,
  isLastParent: boolean,
  now: Date,
): Promise<StudyEraseStats> {
  const stats: StudyEraseStats = {
    sessionsAnonymized: 0,
    sessionsCancelled: 0,
    instancesCancelled: 0,
    instancesScrubbed: 0,
    claimsReleased: 0,
    cascadeErrors: 0,
  };

  const empty = { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
  const [tutorSnap, familySnap] = await Promise.all([
    db
      .collection(STUDY_SESSIONS_COLLECTION)
      .where('tutorUserId', '==', targetUserId)
      .get(),
    familyId
      ? db.collection(STUDY_SESSIONS_COLLECTION).where('familyId', '==', familyId).get()
      : Promise.resolve(empty as any),
  ]);

  // Dedupe by id. The two sides cannot overlap today (`addProfileToUser` makes
  // `parent` mutually exclusive with `tutor`), but keying on the document
  // rather than on the query is what makes that a property of the data instead
  // of an assumption in the loop.
  const sessionDocs = Array.from(
    new Map(
      [...tutorSnap.docs, ...(familySnap as any).docs].map((doc: any) => [doc.id, doc]),
    ).values(),
  ) as FirebaseFirestore.QueryDocumentSnapshot[];

  const releaseClaim = createClaimReleaser(db, now);
  const today = parisDateString(now);

  for (const doc of sessionDocs) {
    // Per-session isolation (the doGdpr / sweep pattern): one poisoned cascade
    // must not abort the erasure and leave the remaining sessions untouched
    // while the user document is deleted out from under them.
    try {
      const session = doc.data();
      const isTutorSide = session.tutorUserId === targetUserId;
      const isFamilySide = !!familyId && session.familyId === familyId;
      const updates: Record<string, unknown> = {};

      // ── Author-keyed uid anonymization, SIDE-INDEPENDENT ──
      // These two run for a tutor erasure as well as a family one, because on a
      // TUTOR-INITIATED proposal `createdByUserId` IS the tutor: `proposeSession`
      // writes `createdByUserId: uid` with `uid` the proposing tutor (:186), the
      // invariant `proposedBy === 'provider'` ⟺ `createdByUserId === tutorUserId`
      // is stated at :28-29, and `respondToSession` deliberately does NOT rewrite
      // it at accept — it records the confirming parent in `parentUserId`
      // *because* `createdByUserId` stays the tutor (:156-161). Gating these on
      // `isFamilySide` left a tutor's raw uid on every session they ever
      // proposed (a tutor-only account has no `familyId`, so the branch never
      // ran) — the exact defect this module exists to close, on the other side
      // of the document. The rule is and always was "anonymize the uid when it
      // names the erased user", which is not a side-specific statement.
      //
      // The `proposedBy` invariant SURVIVES: on such a doc `tutorUserId` and
      // `createdByUserId` are the same uid, so both become 'deleted' together.
      if (session.createdByUserId === targetUserId) updates.createdByUserId = DELETED;
      if (session.parentUserId === targetUserId) updates.parentUserId = DELETED;

      // `message` belongs to whoever CREATED the document, which is not always
      // the family. On a `proposedBy: 'provider'` doc it is the tutor's own
      // free text soliciting the booking (`proposeSession` :48-58, stored at
      // :208); everywhere else it is the family's note to the tutor
      // (`bookSession`). Authorship is what decides erasure for every other
      // free-text field on this document — `postSessionNote` goes with the
      // tutor, `preSessionNote` with the family — so it decides this one too.
      // Leaving it on the family branch by default would have let a tutor's own
      // words outlive their erasure indefinitely while their post-session note,
      // two branches up, was erased immediately.
      const messageIsTutorAuthored = session.proposedBy === 'provider';
      const eraseMessage =
        session.message !== undefined &&
        (messageIsTutorAuthored ? isTutorSide : isFamilySide && isLastParent);
      if (eraseMessage) updates.message = FieldValue.delete();

      if (isTutorSide) {
        updates.tutorUserId = DELETED;
        updates.tutorName = '';
        if (session.postSessionNote !== undefined) {
          updates.postSessionNote = FieldValue.delete();
        }
      }

      if (isFamilySide) {
        if (isLastParent) {
          updates.familyName = '';
          updates.parentName = '';
          updates.students = [];
          updates.studentIds = [];
          if (session.address !== undefined) updates.address = FieldValue.delete();
          if (session.latLng !== undefined) updates.latLng = FieldValue.delete();
          // (`message` is handled above — its author is not always the family.)
          if (session.preSessionNote !== undefined) {
            updates.preSessionNote = FieldValue.delete();
          }
        }
      }

      // Cancel only when there is genuinely no one left to honour the session:
      // the tutor is gone, or the family is (last parent). A surviving
      // co-parent's family keeps its bookings.
      const isLive = session.status === 'pending' || session.status === 'confirmed';
      const cancelling = isLive && (isTutorSide || (isFamilySide && isLastParent));
      if (cancelling) {
        updates.status = 'cancelled';
        updates.statusReason = 'account_deleted';
        updates.cancelledFromStatus = session.status;
        updates.cancelledAt = now;
      }

      // ── Instances (recurring series only) ──
      // Read once; both the note scrub and the cancel walk the same snapshot.
      const instancesSnap = await doc.ref
        .collection(STUDY_INSTANCES_SUBCOLLECTION)
        .get();
      const instanceWrites: {
        ref: FirebaseFirestore.DocumentReference;
        data: Record<string, unknown>;
      }[] = [];
      const claimDates: string[] = [];
      for (const inst of instancesSnap.docs) {
        const data = inst.data();
        const instUpdates: Record<string, unknown> = {};
        if (isTutorSide && data.postSessionNote !== undefined) {
          instUpdates.postSessionNote = FieldValue.delete();
        }
        if (isFamilySide && isLastParent && data.preSessionNote !== undefined) {
          instUpdates.preSessionNote = FieldValue.delete();
        }
        // Mirror `cancelSession`: only FUTURE scheduled occurrences are
        // cancelled. A past `scheduled` occurrence already happened — flipping
        // it to cancelled would rewrite history the surviving party keeps.
        const cancelInstance =
          cancelling &&
          data.status === 'scheduled' &&
          typeof data.date === 'string' &&
          data.date >= today;
        if (cancelInstance) {
          instUpdates.status = 'cancelled';
          instUpdates.statusReason = isTutorSide
            ? 'cancelled_by_tutor'
            : 'cancelled_by_family';
          instUpdates.cancelledAt = now;
          claimDates.push(data.date as string);
        }
        if (Object.keys(instUpdates).length > 0) {
          // The two counters are INDEPENDENT, not a partition. An occurrence
          // that is both note-scrubbed and cancelled must count in both:
          // `instancesScrubbed` is the number an auditor actually wants — how
          // many occurrences lost personal data — and an `else` here would
          // under-report it by exactly the cancelled ones, which are the most
          // likely to have carried a note.
          const noteErased =
            instUpdates.postSessionNote !== undefined ||
            instUpdates.preSessionNote !== undefined;
          instUpdates.updatedAt = now;
          instanceWrites.push({ ref: inst.ref, data: instUpdates });
          if (cancelInstance) stats.instancesCancelled += 1;
          if (noteErased) stats.instancesScrubbed += 1;
        }
      }

      // ── Writes: the documents first, the claim release after ──
      // A family-side session where a co-parent survives and neither
      // `createdByUserId` nor `parentUserId` named the erased user has nothing
      // to change; touching `updatedAt` for that would churn every session of
      // the family on every co-parent deletion.
      if (Object.keys(updates).length > 0) {
        await doc.ref.update({ ...updates, updatedAt: now });
        stats.sessionsAnonymized += 1;
      }
      if (instanceWrites.length > 0) await commitChunked(instanceWrites);
      if (cancelling) stats.sessionsCancelled += 1;

      // Only a SURVIVING tutor's claims need releasing; an erased tutor's whole
      // schedule document goes in step 3.
      if (cancelling && !isTutorSide) {
        const tutorUserId = (session.tutorUserId as string) ?? '';
        if (typeof session.date === 'string' && session.date) {
          // one_time: the ledger entry carries the sessionId and NO instanceId.
          if (
            await releaseClaim(
              tutorUserId,
              session.date,
              (b: SessionBlockEntry) => b.sessionId === doc.id && !b.instanceId,
              STUDY_PROVENANCE,
            )
          ) {
            stats.claimsReleased += 1;
          }
        }
        for (const date of claimDates) {
          if (
            await releaseClaim(
              tutorUserId,
              date,
              (b: SessionBlockEntry) => b.sessionId === doc.id && b.instanceId === date,
              STUDY_PROVENANCE,
            )
          ) {
            stats.claimsReleased += 1;
          }
        }
      }
    } catch (err) {
      stats.cascadeErrors += 1;
      console.error(`eraseStudyUserData: cascade failed for session ${doc.id}:`, err);
    }
  }

  if (stats.cascadeErrors > 0) {
    console.warn(
      `eraseStudyUserData: ${stats.cascadeErrors} session cascade(s) failed for ${targetUserId}`,
    );
  }
  return stats;
}
