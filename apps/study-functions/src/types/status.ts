/**
 * Status values for a tutoring session document.
 * `declined` maps to the plan's `rejected` value (plan §6 uses both terms;
 * `declined` matches the sync-sit convention of provider declining a request).
 */
export type SessionStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'modified'
  | 'completed';

/** Status values for a single recurring session instance. */
export type InstanceStatus =
  | 'scheduled'
  | 'cancelled'
  | 'rescheduled'
  | 'completed';
