import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { parisWallTimeToUtc } from '../scheduled/parisTime.js';
import { getParentProfile, type User } from '@ejm/shared-core';

/**
 * setAppointmentNote — the family's PRE-sitting note or the babysitter's
 * POST-sitting note on an appointment (issue #238, parity B2 — study's
 * setSessionNote adopted into sit; the twins must not disagree on note
 * privacy).
 *
 * ONE callable serves both notes; `kind` selects which note and thus which
 * party may write and which timing window applies:
 *   • 'pre'  — FAMILY-authored (door codes, bedtime, allergies). Any parent of
 *              the appointment's family may write it.
 *   • 'post' — BABYSITTER-authored (how the sitting went). Only the
 *              appointment's babysitter may write it.
 *
 * VISIBILITY mirrors study exactly: both notes live on the appointment doc,
 * whose read rule covers {the family's parents, the babysitter, admin} and
 * which stays client-write-denied (no rules change). Like study's session
 * notes, they are ALSO projected to a supervised babysitter's guardians via
 * the getGovernedChildDetail whitelist (governance ruling 8: supervising
 * parents see everything) — the family-facing dialog copy discloses this.
 *
 * STRUCTURAL ADAPTATIONS from study (see the plan doc):
 *   • Sit has no per-occurrence instance docs, so there is no `instanceId`;
 *     a recurring appointment's notes live on its single doc.
 *   • Timing: a one_time appointment keeps study's exact windows — pre ONLY
 *     until the Paris wall-clock start passes (the family's ask is moot after
 *     that), post ONLY once it has started (the note describes what
 *     happened). A confirmed RECURRING arrangement has no single start
 *     instant — there is always a next occurrence (pre stays meaningful:
 *     door codes, allergies) and, in steady state, past occurrences (post
 *     stays meaningful) — so both windows stay open while it is confirmed.
 *   • Status: sit has no 'completed' — a past sitting stays 'confirmed', so
 *     `confirmed` is the one annotatable status (it subsumes study's
 *     completed case). pending / rejected / cancelled have no sitting to
 *     annotate.
 *
 * Empty `text` clears the note (FieldValue.delete() — the field goes absent,
 * not blank). The author may overwrite their own note freely within its
 * window — and may CLEAR it at ANY time regardless of timing or status (a
 * deliberate divergence from study, tracked for back-porting in issue #255:
 * sit's notes solicit door codes/allergies and reach the supervised sitter's
 * guardians, so the author keeps an erasure path for as long as the
 * appointment is reachable in the UI). The UI stops rendering a card
 * PAST_VISIBILITY_DAYS after the engagement, so past that point the
 * cleanupOldData cron redacts both notes — erasure by the system once the
 * author can no longer do it themselves.
 *
 * Writes are callable-only (rules stay deny-all). v1 is SILENT: writing a
 * note fires NO notification to the counterparty (mirrors study's ledgered
 * decision — the note is seen next time they open the appointment).
 */
const setAppointmentNoteSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  kind: z.enum(['pre', 'post'], {
    errorMap: () => ({ message: "Note kind must be 'pre' or 'post'" }),
  }),
  text: z
    .string()
    .trim()
    .max(2000, 'An appointment note may be at most 2000 characters'),
});

export const setAppointmentNote = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = setAppointmentNoteSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { appointmentId, kind, text } = parsed.data;

    const aptRef = db.collection('appointments').doc(appointmentId);
    const [aptSnap, callerDoc] = await Promise.all([
      aptRef.get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!aptSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }
    const apt = aptSnap.data()!;

    // ── Role gate ── pre = family, post = babysitter (mirrors study: no
    // guardian-actor branch — study's setSessionNote has none either).
    if (kind === 'pre') {
      const callerParent = getParentProfile(callerDoc.data() as User | undefined);
      if (!callerParent?.familyId || callerParent.familyId !== apt.familyId) {
        throw new HttpsError(
          'permission-denied',
          'Only the family may write the pre-appointment note',
        );
      }
    } else {
      if (apt.babysitterUserId !== uid) {
        throw new HttpsError(
          'permission-denied',
          'Only the babysitter may write the post-appointment note',
        );
      }
    }

    // ── Erasure carve-out (a DELIBERATE divergence from study — see issue
    // #255 for porting it back): a CLEAR (empty text) passes only the role
    // gate above. Sit's pre-note copy solicits door codes and a child's
    // allergies, and since round 1 the note is also projected to the
    // supervised sitter's guardians — so the author must always be able to
    // erase their own note, even after the sitting starts or the appointment
    // leaves 'confirmed'. Authoring CONTENT stays window-bound below.
    const cleared = text.length === 0;

    if (!cleared) {
      // ── Status gate ── only a confirmed appointment is annotatable. Sit
      // has no 'completed': a past sitting stays 'confirmed', which is
      // exactly the state study's completed pin covers. pending / rejected /
      // cancelled targets have no sitting to annotate.
      if (apt.status !== 'confirmed') {
        throw new HttpsError(
          'failed-precondition',
          'This appointment cannot take notes in its current state',
        );
      }

      // ── Timing gate (DST-safe, Paris wall-clock) ──
      // Only an explicit recurring doc gets the both-windows-open exemption
      // (no single start instant; see the docstring). Everything else —
      // one_time, and defensively any absent/unknown type — fails CLOSED
      // into the strict windows.
      if (apt.type !== 'recurring') {
        if (!apt.date || !apt.startTime) {
          // A confirmed one_time appointment always carries these; defensive only.
          throw new HttpsError('failed-precondition', 'Appointment has no scheduled date');
        }
        const start = parisWallTimeToUtc(apt.date as string, apt.startTime as string);
        const started = Date.now() >= start.getTime();
        if (kind === 'pre' && started) {
          throw new HttpsError('failed-precondition', 'Appointment already started');
        }
        if (kind === 'post' && !started) {
          throw new HttpsError('failed-precondition', 'Appointment has not started yet');
        }
      }
    }

    // ── Write the note (or clear it) ──
    const field = kind === 'pre' ? 'preAppointmentNote' : 'postAppointmentNote';
    await aptRef.update({
      [field]: cleared ? FieldValue.delete() : text,
      updatedAt: new Date(),
    });

    await writeUserActivity(uid, 'appointment_note_set', {
      appointmentId,
      kind,
      cleared,
    });

    // No notification in v1 (silent — mirrors study's ledgered decision).
    return { success: true };
  },
);
