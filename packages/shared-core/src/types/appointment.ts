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
