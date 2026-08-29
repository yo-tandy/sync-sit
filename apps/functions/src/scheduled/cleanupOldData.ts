import { onSchedule } from 'firebase-functions/v2/scheduler';
import { resolveConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { COMPLETED_ENGAGEMENT_RETENTION_DAYS } from '@ejm/shared-core';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { db } from '../config/firebase.js';
import { runDoSweepTasks } from '../do/sweepTasks.js';
import { runStudySweepSessions } from './sweepStudySessions.js';
import { createClaimReleaser, DATE_RE, SIT_PROVENANCE } from './retentionClaims.js';

/**
 * Lower bound for the sit retention range (block 7a). Below every real
 * 'YYYY-MM-DD' booking date and above '', so the only non-conforming string
 * shape a bare upper bound would return is excluded from the QUERY rather
 * than only from the deletions. See the block comment for the measured
 * Firestore semantics this rests on.
 */
const MIN_BOOKING_DATE = '0001-01-01';

export interface CleanupStats {
  totalDeleted: number;
  notificationsDeleted: number;
  auditLogsDeleted: number;
  inviteLinksDeleted: number;
  verificationCodesDeleted: number;
  accountExistsNoticesDeleted: number;
  verificationSendCountersDeleted: number;
  appointmentsDeleted: number;
  /** Decision 19 / issue #294: confirmed appointments >180d past their date. */
  completedAppointmentsDeleted: number;
  /** Override `sessionBlocks` entries pruned alongside those deletions. */
  appointmentClaimsReleased: number;
  /** Retention cascades that failed and were skipped (poison-pill isolation). */
  appointmentCascadeErrors: number;
  /**
   * Live recurring arrangements the retention query returned because they
   * carry a real past `date`, refused by the terminal-by-shape guard. Should
   * be 0: the date/type coupling is a client convention, so a non-zero value
   * means a caller reached `sendContactRequest` directly.
   */
  appointmentsSkippedNonTerminal: number;
  /**
   * Docs the retention QUERY returned that the date shape guard then refused.
   * Should always be 0: the range bounds are supposed to match only deletable
   * documents, so a non-zero value means a non-conforming shape is riding at
   * the head of the page — the thing that makes a sweep stop draining.
   */
  appointmentsSkippedMalformedDate: number;
  publishedSearchesDeleted: number;
  appointmentNotesRedacted: number;
}

/**
 * GDPR data retention cleanup. Extracted for testability.
 *
 * Retention periods:
 * - Notifications: 30 days
 * - Audit logs: 30 days
 * - Expired invite links: immediate (past expiry)
 * - Expired verification codes: immediate (past expiry)
 * - Account-exists notice markers: 24 hours (their whole purpose is the
 *   24h mail-bomb guard; keeping them longer retains targeted addresses)
 * - Verification send counters: 24 hours past windowStart (the longest
 *   window — the daily address cap — is spent by then; stale counters only
 *   retain targeted addresses)
 * - Cancelled/rejected appointments: 30 days AND date > 7 days ago
 * - COMPLETED appointments (issue #294, decision 19): 180 days past the
 *   booking date. Sit has no `completed` status — a past sitting stays
 *   `confirmed` — so the sweep keys on (status: confirmed, date) and skips
 *   the dateless recurring arrangements, which are still live. The
 *   babysitter's schedule claim for that date is released with the doc.
 * - Published searches: immediate (past expiresAt — the server-computed
 *   min(publish + 7d, babysitting date) lifetime; issue #207)
 * - Appointment notes (issue #238): redacted once the appointment leaves
 *   every UI surface (the configured pastVisibilityDays window, default
 *   7 days -- issue #250; both the dashboards and this redaction read the
 *   same key, so the remove affordance stays reachable for the note's
 *   whole visible life). The notes solicit door codes and a child's
 *   allergies, and setAppointmentNote guarantees the author an erasure
 *   path — but the remove affordance lives on cards the dashboards stop
 *   rendering past that window, so beyond it the system erases for them. Confirmed recurring arrangements (no date) stay
 *   visible, so their notes are never redacted here. DELIBERATE exception:
 *   notes on PENDING docs are retained indefinitely -- pending cards render
 *   forever, so the author permanently keeps the remove affordance instead
 *   of the cron.
 */
export async function runCleanupOldData(
  firestoreDb: Firestore,
  now: Date,
): Promise<CleanupStats> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const stats: CleanupStats = {
    totalDeleted: 0,
    notificationsDeleted: 0,
    auditLogsDeleted: 0,
    inviteLinksDeleted: 0,
    verificationCodesDeleted: 0,
    accountExistsNoticesDeleted: 0,
    verificationSendCountersDeleted: 0,
    appointmentsDeleted: 0,
    completedAppointmentsDeleted: 0,
    appointmentClaimsReleased: 0,
    appointmentCascadeErrors: 0,
    appointmentsSkippedMalformedDate: 0,
    appointmentsSkippedNonTerminal: 0,
    publishedSearchesDeleted: 0,
    appointmentNotesRedacted: 0,
  };

  // 1. Delete old notifications (> 30 days)
  const oldNotifications = await firestoreDb
    .collection('notifications')
    .where('createdAt', '<', thirtyDaysAgo)
    .limit(500)
    .get();

  if (!oldNotifications.empty) {
    const batch = firestoreDb.batch();
    for (const doc of oldNotifications.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    stats.notificationsDeleted = oldNotifications.size;
    stats.totalDeleted += oldNotifications.size;
    console.log(`Deleted ${oldNotifications.size} old notifications`);
  }

  // 2. Delete old audit logs (> 30 days)
  const oldAuditLogs = await firestoreDb
    .collection('auditLogs')
    .where('timestamp', '<', thirtyDaysAgo)
    .limit(500)
    .get();

  if (!oldAuditLogs.empty) {
    const batch = firestoreDb.batch();
    for (const doc of oldAuditLogs.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    stats.auditLogsDeleted = oldAuditLogs.size;
    stats.totalDeleted += oldAuditLogs.size;
    console.log(`Deleted ${oldAuditLogs.size} old audit logs`);
  }

  // 3. Delete expired invite links
  const expiredInvites = await firestoreDb
    .collection('inviteLinks')
    .where('expiresAt', '<', now)
    .limit(500)
    .get();

  if (!expiredInvites.empty) {
    const batch = firestoreDb.batch();
    for (const doc of expiredInvites.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    stats.inviteLinksDeleted = expiredInvites.size;
    stats.totalDeleted += expiredInvites.size;
    console.log(`Deleted ${expiredInvites.size} expired invite links`);
  }

  // 4. Delete expired verification codes
  const expiredCodes = await firestoreDb
    .collection('verificationCodes')
    .where('expiresAt', '<', now)
    .limit(500)
    .get();

  if (!expiredCodes.empty) {
    const batch = firestoreDb.batch();
    for (const doc of expiredCodes.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    stats.verificationCodesDeleted = expiredCodes.size;
    stats.totalDeleted += expiredCodes.size;
    console.log(`Deleted ${expiredCodes.size} expired verification codes`);
  }

  // 5. Delete account-exists notice markers older than their 24h guard
  // window (issue #148): past that they only retain the addresses of
  // targeted accounts, so their lifetime should match their semantics.
  // Unlike the other blocks, this one LOOPS until a pass returns fewer than
  // the batch limit: an enumeration spray writes one marker per targeted
  // address, and a single 500-doc pass per day would let the backlog (and
  // the retained address list) grow unboundedly. The iteration ceiling
  // (40 passes = 20k docs/run) is a runaway backstop, far above any
  // legitimate volume.
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  for (let pass = 0; pass < 40; pass++) {
    const staleNotices = await firestoreDb
      .collection('accountExistsNotices')
      .where('lastSentAt', '<', twentyFourHoursAgo)
      .limit(500)
      .get();

    if (!staleNotices.empty) {
      const batch = firestoreDb.batch();
      for (const doc of staleNotices.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      stats.accountExistsNoticesDeleted += staleNotices.size;
      stats.totalDeleted += staleNotices.size;
      console.log(`Deleted ${staleNotices.size} stale account-exists notice markers`);
    }
    if (staleNotices.size < 500) break;
  }

  // 6. Delete verification send counters whose window fully elapsed (issue
  // #155): both budgets (24h address cap, 1h bypass allowance) are inert
  // once windowStart is 24h old, and past that the address counters only
  // retain the addresses an abuser targeted. Same drain-loop rationale as
  // the accountExistsNotices block above — a send spray writes one counter
  // per targeted address, so a single 500-doc daily pass could never drain
  // the backlog.
  for (let pass = 0; pass < 40; pass++) {
    const staleCounters = await firestoreDb
      .collection('verificationSendCounters')
      .where('windowStart', '<', twentyFourHoursAgo)
      .limit(500)
      .get();

    if (!staleCounters.empty) {
      const batch = firestoreDb.batch();
      for (const doc of staleCounters.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      stats.verificationSendCountersDeleted += staleCounters.size;
      stats.totalDeleted += staleCounters.size;
      console.log(`Deleted ${staleCounters.size} stale verification send counters`);
    }
    if (staleCounters.size < 500) break;
  }

  // 7. Delete old cancelled/rejected appointments
  // Keep for 30 days OR until 7 days after booking date (whichever is longer)
  const oldAppointments = await firestoreDb
    .collection('appointments')
    .where('status', 'in', ['cancelled', 'rejected'])
    .where('createdAt', '<', thirtyDaysAgo)
    .limit(500)
    .get();

  if (!oldAppointments.empty) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    const batch = firestoreDb.batch();
    let count = 0;
    for (const doc of oldAppointments.docs) {
      const data = doc.data();
      const bookingDate = data.date || ''; // YYYY-MM-DD string
      // Delete if no booking date or booking date is > 7 days ago
      if (!bookingDate || bookingDate < sevenDaysAgoStr) {
        batch.delete(doc.ref);
        count++;
      }
    }
    if (count > 0) {
      await batch.commit();
      stats.appointmentsDeleted = count;
      stats.totalDeleted += count;
      console.log(`Deleted ${count} old cancelled/rejected appointments`);
    }
  }

  // 7a. Delete COMPLETED sit engagements older than 180 days — decision 19
  // ("there's no reason to retain completed engagement indefinitely — in any
  // of the sync apps"; sync-do plan §2, §11.4; issue #294). sync-do shipped
  // this from day one in `doSweepTasks`; this is the sit half.
  //
  // WHAT "COMPLETED" MEANS IN SIT. Sit has NO `completed` status — the
  // AppointmentStatus vocabulary is pending | confirmed | rejected |
  // cancelled, and a sitting that simply happened stays `confirmed` forever
  // (setAppointmentNote.ts:40 states the same thing). So there is no
  // `completedAt` to key on the way `doTasks` and `study-sessions` have one:
  // the terminal sit engagement is a CONFIRMED appointment whose booking
  // `date` is past, and the retention clock runs from that date. The query is
  // (status, date) — the composite added with this sweep.
  //
  // A CONFIRMED RECURRING ARRANGEMENT IS LIVE AND MUST NEVER BE SWEPT.
  // `AppointmentDoc.date` is declared `date?: string`, but the TYPE says
  // nothing about what production wrote — every creation path stores an
  // explicit null: `sendContactRequest.ts:83` and `:118` (`data.date ||
  // null`), `contactPublishedSearch.ts:167` (`search.date ?? null`),
  // `resubmitAppointment.ts:133` (`original.date || null`). So these docs are
  // NOT absent from the (status, date) index; they are in it, with a null.
  //
  // What keeps them out of this query is a Firestore semantic worth writing
  // down, because it is easy to get wrong in both directions (PR #396 review
  // did, and so did this comment's first draft). A range filter constrains to
  // the TYPE of its bound: `where('date', '<', <string>)` matches only
  // STRING-valued `date` fields. Measured directly against the emulator over
  // fixtures {null, '', absent, '2020-01-01', '2030-01-01', 5, false}:
  //     date < '2026-01-01'                        -> ['', '2020-01-01']
  //     date >= '0001-01-01' AND date < '2026-01-01' -> ['2020-01-01']
  //     orderBy('date') with no filter             -> all six (null included)
  // Cross-type ordering is real for orderBy — null does sort below strings —
  // but the inequality filter never surfaces the other types at all. So the
  // null recurring arrangements never enter this page, and they cannot crowd
  // out the documents the sweep wants.
  //
  // `date: ''` is the one non-conforming shape a bare upper bound WOULD
  // return (it is a string, and '' sorts below every cutoff). No current
  // writer produces it — `publishSearch.ts:177` stores a DATE_RE-validated
  // string or null, and the two `|| null` writers coerce '' to null — but
  // guarding it costs one clause, and a page full of such docs ahead of every
  // deletable one is precisely the "matches only deletable docs, therefore
  // drains by construction" property 7b's comment contrasts itself against.
  // Hence the LOWER bound below (7b's `where(field, '>', '')` precedent),
  // which excludes '' structurally, and the cursor pagination, which means
  // no non-conforming doc can hold the head of the page even if one appears.
  //
  // The in-memory shape guard below is DEFENCE IN DEPTH — do not delete it as
  // redundant. It is the last thing between this sweep and deleting a live
  // arrangement, and the two opposite wrong premises about these semantics
  // are exactly the reason to keep belt and braces both.
  //
  // `pending` docs are untouched (they render forever — 7b's deliberate
  // exception), and cancelled/rejected retention above is unchanged.
  //
  // TWO USER-VISIBLE CONSEQUENCES, both deliberate. (1) The family's
  // reference-submission window closes at 180 days: submitFamilyEndorsement
  // requires the appointment to exist AND still be `confirmed`. (2) The star
  // "returning babysitter" marker in family search silently becomes
  // "returning within six months" — SearchPage.tsx:249-256 builds
  // `returningIds` from EVERY confirmed appointment of the family, unbounded
  // by date, and :709 renders it. Both change behaviour with no client
  // change, which is why they are written down rather than found later.
  //
  // CASCADE. The notes (`preAppointmentNote`, `postAppointmentNote`) are
  // fields on the doc and leave with it. The one thing that does NOT leave
  // with it is the babysitter's schedule claim: confirming AND-blocked
  // `schedules/{babysitterUserId}/overrides/{date}` and appended a
  // `sessionBlocks` ledger entry, and because sit never marks an appointment
  // completed, NOTHING prunes that entry today. Deleting the appointment
  // without releasing the claim would leave a ledger entry naming a document
  // that no longer exists.
  {
    const retentionCutoff = new Date(
      now.getTime() - COMPLETED_ENGAGEMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const retentionCutoffStr = retentionCutoff.toISOString().split('T')[0];
    const releaseClaim = createClaimReleaser(firestoreDb, now);

    // Cursor-paginated WITHIN the run: a doc the guard skipped, or one whose
    // cascade failed, stays in the index, so a head-restarting pass loop
    // would re-fetch the same prefix every pass and make no progress past
    // it. `startAfter(snapshot)` is value-based ((date, __name__) — the
    // implicit tiebreak means no doc is ever skipped), so it positions
    // correctly even though the previous page's docs have just been deleted.
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    // Soft wall-clock budget, so this block's cost is bounded structurally
    // rather than arithmetically. At full pass budget it is 2000 documents,
    // each a sequential override probe plus a delete plus — on the FIRST run
    // after deploy, when the backlog and the claim-hit rate are both at their
    // maximum — a transaction, and it shares one 540s invocation with the
    // note redaction, the published-search sweep, and the do and study
    // sweeps. A deferred retention pass costs nothing; a starved redaction
    // pass does. Same asymmetry the block-level try/catch below rests on.
    const blockStartedAt = Date.now();
    const BLOCK_BUDGET_MS = 120_000;
    // BLOCK-LEVEL isolation, distinct from the per-document isolation inside.
    // The `query.get()` below is the one statement here that is not already
    // inside a per-doc try, and a throw from it would propagate out of
    // runCleanupOldData and starve EVERY LATER BLOCK — 7b's note redaction
    // (door codes, allergy details) and block 8's expired-published-search
    // deletion, which is what bounds an expired doc's readable window to
    // <24h. The likeliest trigger is the very condition the new composite
    // exists for: FAILED_PRECONDITION while `(status ASC, date ASC)` is
    // still building after a release, which would repeat every day until the
    // build finishes. Deferring a retention pass costs nothing (the next run
    // restarts from the head); deferring redaction and the published-search
    // sweep does. So this block fails CLOSED into a log, the way the handler
    // already isolates the three top-level sweeps from each other.
    try {
      for (let pass = 0; pass < 10; pass++) {
        let query = firestoreDb
          .collection('appointments')
          .where('status', '==', 'confirmed')
          // Lower bound — the load-bearing half. Excludes null (every recurring
          // arrangement), '' and every non-string type; see the block comment.
          .where('date', '>=', MIN_BOOKING_DATE)
          .where('date', '<', retentionCutoffStr)
          .orderBy('date')
          .limit(200);
        if (cursor) query = query.startAfter(cursor);
        const pastConfirmed = await query.get();
        if (pastConfirmed.empty) break;

        // Per-appointment isolation (doSweepTasks' pattern): one poisoned
        // cascade logs and continues, so a deterministic per-doc failure can
        // never wedge this category every day. A failure of the PAGE FETCH
        // itself is caught one level out — see the block-level note above.
        let deleted = 0;
        let skipped = 0;
        let skippedNonTerminal = 0;
        for (const doc of pastConfirmed.docs) {
          const bookingDate = doc.get('date');
          // Defence in depth behind the range bounds — see the block comment.
          if (typeof bookingDate !== 'string' || !DATE_RE.test(bookingDate)) {
            skipped += 1;
            continue;
          }
          // TERMINAL-BY-SHAPE guard, and the reason it is not redundant with
          // the two date checks: those both reason about the DATE, and a
          // recurring arrangement carrying a real past date passes all of
          // them. The date/type coupling is NOT enforced server-side on every
          // path — `publishSearch.ts:177` nulls the date for recurring
          // structurally, but `sendContactRequest` validates only
          // babysitterUserId and familyId and writes `date: data.date || null`
          // unconditionally (:83, :118), with the coupling living in the
          // client (SearchPage.tsx:303); `resubmitAppointment.ts:133` then
          // inherits whatever the original had. So a family calling the
          // callable directly with {searchType:'recurring', recurringSlots:
          // [...], date:'2020-01-01'} mints a LIVE arrangement that every
          // date-shaped check here would wave through 180 days later.
          // Deciding terminality from the document's OWN SHAPE keeps the
          // invariant local to this sweep instead of resting on three writers
          // staying correct.
          const slots = doc.get('recurringSlots');
          if (doc.get('type') === 'recurring' || (Array.isArray(slots) && slots.length > 0)) {
            skippedNonTerminal += 1;
            continue;
          }
          try {
            const babysitterUserId = (doc.get('babysitterUserId') as string) ?? '';
            const released = await releaseClaim(
              babysitterUserId,
              bookingDate,
              (b) => b.appointmentId === doc.id,
              SIT_PROVENANCE,
            );
            if (released) stats.appointmentClaimsReleased += 1;
            // Doc last: a claim release that throws leaves the appointment in
            // place, so the whole cascade retries next run instead of leaving a
            // ledger entry pointing at nothing.
            await doc.ref.delete();
            deleted += 1;
          } catch (err) {
            stats.appointmentCascadeErrors += 1;
            console.error(`cleanupOldData: retention cascade failed for ${doc.id}:`, err);
          }
        }
        stats.completedAppointmentsDeleted += deleted;
        stats.totalDeleted += deleted;
        console.log(
          `Deleted ${deleted} completed appointments >${COMPLETED_ENGAGEMENT_RETENTION_DAYS}d past their date (decision 19)`,
        );
        stats.appointmentsSkippedMalformedDate += skipped;
        stats.appointmentsSkippedNonTerminal += skippedNonTerminal;
        if (skippedNonTerminal > 0) {
          console.warn(
            `cleanupOldData: ${skippedNonTerminal} recurring arrangement(s) carried a past date and were refused by the terminal-shape guard`,
          );
        }
        if (skipped > 0) {
          // A doc that passed both range bounds but failed the shape guard is a
          // malformed `date` no writer produces — say so loudly rather than
          // letting it read as a healthy run.
          console.warn(
            `cleanupOldData: ${skipped} appointment(s) matched the retention range but failed the date shape guard`,
          );
        }
        cursor = pastConfirmed.docs[pastConfirmed.docs.length - 1];
        if (pastConfirmed.size < 200) break;
        if (Date.now() - blockStartedAt > BLOCK_BUDGET_MS) {
          console.warn(
            'cleanupOldData: appointment retention sweep hit its time budget; the remainder is deferred to the next run',
          );
          break;
        }
        if (pass === 9) {
          console.warn(
            'cleanupOldData: appointment retention sweep hit its 10-pass ceiling; the remainder is deferred to the next run',
          );
        }
      }
    } catch (err) {
      // Deliberately swallowed — see the block-level isolation note above.
      // The counters already reflect whatever this run managed before the
      // failure, and the next run picks the sweep up from the head.
      console.error('cleanupOldData: appointment retention sweep failed; later blocks continue:', err);
    }
    if (stats.appointmentCascadeErrors > 0) {
      // The handler discards the returned stats, so the counter reaches
      // nobody unless it is logged at a severity that shows.
      console.warn(
        `cleanupOldData: ${stats.appointmentCascadeErrors} appointment retention cascade(s) failed and were skipped`,
      );
    }
  }

  // 7b. Redact appointment notes once the appointment has left every UI
  // surface (issue #238). Both dashboards bound their lists by the
  // admin-configurable pastVisibilityDays (issue #250; past confirmed by
  // `date`, cancelled/rejected by `updatedAt`), so the redaction window
  // READS THE SAME KEY -- raising the dashboard window automatically
  // defers redaction, keeping the remove affordance reachable for the
  // note's whole visible life. Sit has no per-appointment route beyond
  // the dashboards — so
  // once a card ages out, the note's author can no longer reach the remove
  // affordance that setAppointmentNote's erasure carve-out feeds. The cron
  // erases for them: door codes and allergy details are operational data
  // with no value past the engagement. One single-field range query per
  // note field (docs missing the field never match), window filtering in
  // memory; the doc itself is kept.
  {
    // Read through the INJECTED handle (this function's testability
    // contract) and resolve bounds/fallback with the shared pure helper --
    // getConfigValue would reach for the module-level db (round-3 review).
    const configSnap = await firestoreDb.doc('adminConfig/values').get().catch(() => null);
    const visibilityDays = resolveConfigValue(
      configSnap?.data()?.pastVisibilityDays,
      'pastVisibilityDays',
    );
    const redactionCutoff = new Date(now.getTime() - visibilityDays * 24 * 60 * 60 * 1000);
    const redactionCutoffStr = redactionCutoff.toISOString().split('T')[0];
    const outOfReach = (data: FirebaseFirestore.DocumentData): boolean => {
      // pending: never redacted -- a DELIBERATE, unbounded retention
      // exception. Pending cards render forever, so the author permanently
      // keeps the remove affordance instead of the cron; nothing else in
      // this file deletes a pending doc either, so an odd-history note on
      // one lives until its author removes it.
      if (data.status === 'pending') return false;
      if (data.status === 'confirmed') {
        // Dateless (recurring) arrangements stay on the dashboard forever.
        // <= not <: the dashboards compare a timestamped cutoff against the
        // date's UTC midnight, so a card dated exactly seven days ago is
        // already hidden by the time the cron fires -- a strict < would
        // retain its note one extra day past reachability (round-8 review).
        return typeof data.date === 'string' && data.date !== '' && data.date <= redactionCutoffStr;
      }
      if (data.status === 'cancelled' || data.status === 'rejected') {
        // Absent/malformed updatedAt counts as OUT of reach: the dashboards
        // coalesce it to epoch (`?.toDate?.() || new Date(0)`), which hides
        // the card immediately -- so the cron must erase what nobody can
        // reach, not fail open and retain it (round-7 review).
        const updatedAt = data.updatedAt?.toDate?.() ?? new Date(0);
        return updatedAt < redactionCutoff;
      }
      // Anything else -- absent or malformed status -- is OUT of reach:
      // both dashboards bucket on the closed four-value status set and
      // silently drop unknowns, so no card renders and nobody can reach the
      // remove affordance. Fail closed by structure, not by enumeration
      // (round-9 review).
      return true;
    };

    // Cursor-paginated drain WITH a persisted cursor: the range query
    // matches EVERY note-carrying doc (in-window ones included), so a
    // capped in-run walk could permanently skip the index tail once
    // note-carrying docs exceed 40 passes x 500 — unlike the sibling
    // sweeps, whose queries match only deletable docs and therefore drain
    // across runs by construction (round-10 review). Persisting the cursor
    // (cronState/appointmentNoteRedaction) makes this sweep drain across
    // runs the same way: a run that hits the pass ceiling stores where it
    // stopped and the next run RESUMES there; an exhausted walk resets the
    // cursor so the next run starts from the head. Ties on the note text
    // are broken by document id so resume never skips a doc.
    //
    // The persisted cursor stores ONLY the doc id — never the note text
    // (persisting the orderBy value verbatim would copy a door code into a
    // doc nothing sweeps; PR #274 review). Resume re-reads the doc and
    // startAfter(snapshot) takes its position from the LIVE field values;
    // if the doc lost its note meanwhile (cleared, redacted, deleted), the
    // walk safely restarts from the head — re-examining is idempotent,
    // skipping is not.
    //
    // cronState has no firestore.rules block on purpose: it is server-only
    // state, covered by the deny-all catch-all.
    const cursorStateRef = firestoreDb.collection('cronState').doc('appointmentNoteRedaction');
    const cursorState = (await cursorStateRef.get()).data() ?? {};
    const nextCursorState: Record<string, string | null> = {};

    for (const field of ['preAppointmentNote', 'postAppointmentNote'] as const) {
      const storedId = cursorState[`${field}Cursor`] as string | null | undefined;
      let cursorSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (storedId) {
        const resumeSnap = await firestoreDb.collection('appointments').doc(storedId).get();
        if (resumeSnap.exists && resumeSnap.get(field) !== undefined) {
          cursorSnap = resumeSnap;
        }
      }
      // The persisted resume point is the last SURVIVING (non-redacted)
      // doc seen: the boundary doc of a truncated pass is usually redacted
      // (it is redacted exactly when out-of-reach), and a redacted doc's
      // note is gone, so resuming from it would fall back to the head and
      // throw the run's progress away (PR #274 round 2). A survivor keeps
      // its note, so resume always lands; if EVERY examined doc was
      // redacted, the examined prefix left the index entirely and a head
      // restart re-examines nothing.
      let lastSurvivorId: string | null = storedId ?? null;
      let exhausted = false;
      for (let pass = 0; pass < 40; pass++) {
        let query = firestoreDb
          .collection('appointments')
          .where(field, '>', '')
          .orderBy(field)
          .orderBy(FieldPath.documentId())
          .limit(500);
        if (cursorSnap) query = query.startAfter(cursorSnap);
        const noted = await query.get();
        if (noted.empty) {
          exhausted = true;
          break;
        }

        const batch = firestoreDb.batch();
        let count = 0;
        for (const doc of noted.docs) {
          if (outOfReach(doc.data())) {
            batch.update(doc.ref, { [field]: FieldValue.delete() });
            count++;
          } else {
            lastSurvivorId = doc.id;
          }
        }
        if (count > 0) {
          await batch.commit();
          stats.appointmentNotesRedacted += count;
          console.log(`Redacted ${count} out-of-reach ${field} values`);
        }
        cursorSnap = noted.docs[noted.docs.length - 1];
        if (noted.size < 500) {
          exhausted = true;
          break;
        }
        if (pass === 39) {
          // Deferred, not lost: the stored cursor makes the next run resume
          // exactly here (round-7 asked for the truncation to be visible;
          // round-10 made it recoverable).
          console.warn(
            `Appointment-note redaction sweep hit its 40-pass ceiling for ${field}; resuming from stored cursor next run`,
          );
        }
      }
      // Exhausted -> wrap to the head next run; truncated -> resume from
      // the last surviving doc (see above).
      nextCursorState[`${field}Cursor`] = exhausted ? null : lastSurvivorId;
    }
    await cursorStateRef.set(nextCursorState, { merge: true });
  }

  // 8. Delete expired published searches (issue #207). Client queries filter
  // expiry only client-side (list rules can't prove an expiresAt bound), so
  // this sweep is what bounds an expired doc's readable window to <24h.
  // Bounded multi-pass like blocks 5/6 — the per-family cap keeps volume
  // low in practice, but the loop makes the bound structural (PR #210
  // review) rather than an assumption about community size.
  stats.publishedSearchesDeleted = 0;
  for (let pass = 0; pass < 40; pass++) {
    const expiredPublished = await firestoreDb
      .collection('publishedSearches')
      .where('expiresAt', '<', now)
      .limit(500)
      .get();
    if (expiredPublished.empty) break;
    const batch = firestoreDb.batch();
    for (const doc of expiredPublished.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    stats.publishedSearchesDeleted += expiredPublished.size;
    stats.totalDeleted += expiredPublished.size;
    console.log(`Deleted ${expiredPublished.size} expired published searches`);
    if (expiredPublished.size < 500) break;
  }

  console.log(`Data retention cleanup complete. Total deleted: ${stats.totalDeleted}`);
  return stats;
}

export const cleanupOldData = onSchedule(
  {
    schedule: 'every day 03:00',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
    // The job now runs BOTH sweeps in one invocation, and the sync-do half
    // adds Storage listings and per-object Firestore queries — the 60s v2
    // default was sized for runCleanupOldData alone and would truncate the
    // second half silently on the first backlog day. 540s is the
    // scheduled-function ceiling; memory raised alongside since the paged
    // object listings hold up to a page of metadata each.
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const now = new Date();
    // The sync-do sweep, and now the sync-study one (issue #294), ride this
    // schedule rather than adding further jobs (plan §8's doSweepTasks row).
    // The halves are independent: a failure in one must not starve the
    // others, so each error is captured and the first is rethrown at the end
    // (a thrown error is what surfaces the run as failed in Cloud Scheduler).
    let firstError: unknown = null;
    try {
      await runCleanupOldData(db, now);
    } catch (err) {
      console.error('runCleanupOldData failed:', err);
      firstError = err;
    }
    try {
      await runDoSweepTasks(db, getStorage().bucket(), now);
    } catch (err) {
      console.error('runDoSweepTasks failed:', err);
      firstError = firstError ?? err;
    }
    try {
      await runStudySweepSessions(db, now);
    } catch (err) {
      console.error('runStudySweepSessions failed:', err);
      firstError = firstError ?? err;
    }
    if (firstError) throw firstError;
  },
);
