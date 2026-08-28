import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
import { getParentProfile, type User } from '@ejm/shared-core';
import { setSessionNoteSchema } from '../validation/session.js';

/**
 * setSessionNote — the family's PRE-session note or the tutor's POST-session
 * note on a tutoring session (V1.1 feature 1).
 *
 * ONE callable serves both notes; `kind` selects which note and thus which party
 * may write and which timing window applies:
 *   • 'pre'  — FAMILY-authored ("focus on fractions this week"). Any parent of
 *              the session's family may write it, but ONLY until the session's
 *              start time passes (after that the family's ask is moot).
 *   • 'post' — TUTOR-authored (what was covered / homework). Only the session's
 *              tutor may write it, and ONLY once the session has STARTED (the
 *              note describes what happened; not gated on the completion cron).
 *
 * NOTE LOCATION mirrors the session's authority split: a one_time session's
 * notes live on the parent SessionDoc; a recurring series' notes live
 * per-occurrence on the SessionInstanceDoc (so `instanceId` is required for a
 * recurring series and forbidden for a one_time one).
 *
 * Empty `text` clears the note (FieldValue.delete() — the field goes absent, not
 * blank). The author may overwrite their own note freely within its window —
 * and may CLEAR it at ANY time regardless of timing or status (issue #255,
 * mirroring sit's setAppointmentNote carve-out: a solicited note — the pre
 * placeholder invites specifics about a child — must always be erasable by
 * its author, because the reader keeps read access to the doc indefinitely;
 * without the carve-out the note becomes a one-way door the moment the
 * session starts or leaves its annotatable status). Authoring CONTENT stays
 * window-bound.
 *
 * Writes are callable-only (rules stay deny-all). v1 is SILENT: writing a note
 * fires NO notification to the counterparty (ledgered decision — the note is
 * seen next time they open the session).
 */
export const setSessionNote = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = setSessionNoteSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { sessionId, instanceId, kind, text } = parsed.data;

    const sessionRef = db.collection('study-sessions').doc(sessionId);
    const [sessionSnap, callerDoc] = await Promise.all([
      sessionRef.get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', 'Session not found');
    }
    const session = sessionSnap.data()!;

    // ── Resolve the target doc (parent for one_time, instance for recurring) ──
    // instanceId is meaningful ONLY for a recurring series; a one_time session's
    // notes live on the parent doc.
    if (session.type === 'recurring' && !instanceId) {
      throw new HttpsError(
        'invalid-argument',
        'A recurring series stores notes per occurrence — an instanceId is required',
      );
    }
    if (session.type !== 'recurring' && instanceId) {
      throw new HttpsError(
        'invalid-argument',
        'Only a recurring series takes a per-occurrence instanceId',
      );
    }

    let targetRef = sessionRef;
    let targetData = session;
    let targetStatus = session.status as string;
    let targetDate = session.date as string | undefined;
    let targetStartTime = session.startTime as string;

    if (instanceId) {
      const instanceRef = sessionRef.collection('instances').doc(instanceId);
      const instanceSnap = await instanceRef.get();
      if (!instanceSnap.exists) {
        throw new HttpsError('not-found', 'Session occurrence not found');
      }
      const instance = instanceSnap.data()!;
      targetRef = instanceRef;
      targetData = instance;
      targetStatus = instance.status as string;
      targetDate = instance.date as string;
      targetStartTime = instance.startTime as string;
    }

    // ── Role gate ── pre = family, post = tutor.
    if (kind === 'pre') {
      const callerParent = getParentProfile(callerDoc.data() as User | undefined);
      if (!callerParent?.familyId || callerParent.familyId !== session.familyId) {
        throw new HttpsError(
          'permission-denied',
          'Only the family may write the pre-session note',
        );
      }
    } else {
      if (session.tutorUserId !== uid) {
        throw new HttpsError(
          'permission-denied',
          'Only the tutor may write the post-session note',
        );
      }
    }

    // ── Erasure carve-out (issue #255 — ported from sit's setAppointmentNote,
    // where it landed first in PR #253): a CLEAR (empty text) passes only the
    // role gate above. The pre-note solicits specifics about a child and the
    // counterparty keeps read access to the doc indefinitely — so the author
    // must always be able to erase their own note, even after the session
    // starts or the target leaves its annotatable status. Authoring CONTENT
    // stays window-bound below.
    const cleared = text.length === 0;

    if (!cleared) {
      // ── Status gate ── the target must be a live/settled session to annotate.
      // A one_time parent is annotatable when 'confirmed' or 'completed'; a
      // recurring occurrence when 'scheduled' or 'completed'. declined / cancelled
      // / pending / modified targets have no session to annotate.
      const annotatable = instanceId
        ? targetStatus === 'scheduled' || targetStatus === 'completed'
        : targetStatus === 'confirmed' || targetStatus === 'completed';
      if (!annotatable) {
        throw new HttpsError(
          'failed-precondition',
          'This session cannot take notes in its current state',
        );
      }

      // ── Timing gate (DST-safe, Paris wall-clock) ──
      if (!targetDate) {
        // A confirmed one_time session always carries a date; defensive only.
        throw new HttpsError('failed-precondition', 'Session has no scheduled date');
      }
      const start = parisWallTimeToUtc(targetDate, targetStartTime);
      const started = Date.now() >= start.getTime();
      if (kind === 'pre' && started) {
        throw new HttpsError('failed-precondition', 'Session already started');
      }
      if (kind === 'post' && !started) {
        throw new HttpsError('failed-precondition', 'Session has not started yet');
      }
    }

    // ── Write the note (or clear it) on the correct doc ──
    // A CLEAR deliberately does NOT bump updatedAt (mirrors sit): erasure is
    // not a change the counterparty should be re-alerted to, and updatedAt
    // keeps meaning "last real change". Content writes still bump it.
    const field = kind === 'pre' ? 'preSessionNote' : 'postSessionNote';
    if (cleared) {
      if (targetData[field] === undefined) {
        // No-op clear: nothing stored, nothing to erase. Succeed without
        // touching the doc at all.
        return { success: true };
      }
      await targetRef.update({ [field]: FieldValue.delete() });
    } else {
      await targetRef.update({ [field]: text, updatedAt: new Date() });
    }

    await writeUserActivity(uid, 'session_note_set', {
      sessionId,
      instanceId: instanceId ?? null,
      kind,
      cleared,
    });

    // No notification in v1 (silent — ledgered decision).
    return { success: true };
  },
);
