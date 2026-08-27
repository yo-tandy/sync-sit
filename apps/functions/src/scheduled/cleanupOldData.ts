import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

export interface CleanupStats {
  totalDeleted: number;
  notificationsDeleted: number;
  auditLogsDeleted: number;
  inviteLinksDeleted: number;
  verificationCodesDeleted: number;
  accountExistsNoticesDeleted: number;
  verificationSendCountersDeleted: number;
  appointmentsDeleted: number;
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
 * - Published searches: immediate (past expiresAt — the server-computed
 *   min(publish + 7d, babysitting date) lifetime; issue #207)
 * - Appointment notes (issue #238): redacted once the appointment leaves
 *   every UI surface (PAST_VISIBILITY_DAYS = 7). The notes solicit door
 *   codes and a child's allergies, and setAppointmentNote guarantees the
 *   author an erasure path — but the remove affordance lives on cards the
 *   dashboards stop rendering after 7 days, so past that point the system
 *   erases for them. Confirmed recurring arrangements (no date) stay
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

  // 7b. Redact appointment notes once the appointment has left every UI
  // surface (issue #238). Both dashboards bound their lists by
  // PAST_VISIBILITY_DAYS = 7 (past confirmed by `date`, cancelled/rejected
  // by `updatedAt`), and sit has no per-appointment route beyond them — so
  // once a card ages out, the note's author can no longer reach the remove
  // affordance that setAppointmentNote's erasure carve-out feeds. The cron
  // erases for them: door codes and allergy details are operational data
  // with no value past the engagement. One single-field range query per
  // note field (docs missing the field never match), window filtering in
  // memory; the doc itself is kept.
  {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
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
        return typeof data.date === 'string' && data.date !== '' && data.date <= sevenDaysAgoStr;
      }
      if (data.status === 'cancelled' || data.status === 'rejected') {
        // Absent/malformed updatedAt counts as OUT of reach: the dashboards
        // coalesce it to epoch (`?.toDate?.() || new Date(0)`), which hides
        // the card immediately -- so the cron must erase what nobody can
        // reach, not fail open and retain it (round-7 review).
        const updatedAt = data.updatedAt?.toDate?.() ?? new Date(0);
        return updatedAt < sevenDaysAgo;
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
    const cursorStateRef = firestoreDb.collection('cronState').doc('appointmentNoteRedaction');
    const cursorState = (await cursorStateRef.get()).data() ?? {};
    const nextCursorState: Record<string, { value: string; id: string } | null> = {};

    for (const field of ['preAppointmentNote', 'postAppointmentNote'] as const) {
      const stored = cursorState[`${field}Cursor`] as { value: string; id: string } | null | undefined;
      let cursor: { value: string; id: string } | null = stored ?? null;
      let exhausted = false;
      for (let pass = 0; pass < 40; pass++) {
        let query = firestoreDb
          .collection('appointments')
          .where(field, '>', '')
          .orderBy(field)
          .orderBy(FieldPath.documentId())
          .limit(500);
        if (cursor) query = query.startAfter(cursor.value, cursor.id);
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
          }
        }
        if (count > 0) {
          await batch.commit();
          stats.appointmentNotesRedacted += count;
          console.log(`Redacted ${count} out-of-reach ${field} values`);
        }
        const last = noted.docs[noted.docs.length - 1];
        cursor = { value: last.get(field) as string, id: last.id };
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
      // Exhausted -> wrap to the head next run; truncated -> resume.
      nextCursorState[`${field}Cursor`] = exhausted ? null : cursor;
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
  },
  async () => {
    await runCleanupOldData(db, new Date());
  },
);
