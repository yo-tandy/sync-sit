import type { DayOfWeek } from '../constants/config.js';

/**
 * A single recurring weekly slot. Used by sync-sit's babysitting recurring
 * searches/appointments and by sync-study's recurring tutoring sessions.
 */
export interface RecurringSlot {
  day: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string;
}

/**
 * Who initiated a pending session/appointment: the family (the default, and the
 * only shape sit ships today) or the provider (a tutor/babysitter proposing a
 * concrete session to an approved family). Seeded here in shared-core as sit's
 * adoption seam — study-only in v1 (tutor-initiated booking), so a DELIBERATE
 * roadmap deviation (the trial-sessions precedent): the vocabulary lives cross-app
 * even though only sync-study consumes it now.
 *
 * INVARIANT (study): `proposedBy === 'provider'` ⟺ `createdByUserId === tutorUserId`.
 * Stored EXPLICITLY rather than derived, so a reader never has to compare ids to
 * know the flow — and so the guard that a proposer can never confirm their own doc
 * keys off one field. Absent on legacy docs — treat absence as `'family'`.
 */
export type ProposedBy = 'provider' | 'family';

/**
 * Cancellation-notice policy presets (V2 feature 7). A provider-chosen minimum
 * notice for cancelling a CONFIRMED commitment, in hours before the session's
 * Paris wall-clock start. 0 = no policy (never flags). Cancellations inside the
 * window still succeed but are recorded with `lateCancellation: true` on the
 * commitment (soft enforcement — this is a school community; emergencies happen).
 * The value is SNAPSHOTTED onto the session at request-creation time, so a
 * provider editing their policy later cannot retroactively re-classify existing
 * bookings. Study-only in v1; lives here (like ProposedBy) as the seam for
 * sync-sit adoption.
 */
export const CANCELLATION_NOTICE_PRESETS = [0, 24, 48, 168] as const;
export type CancellationNoticeHours = (typeof CANCELLATION_NOTICE_PRESETS)[number];
