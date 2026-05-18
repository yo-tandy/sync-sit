export const AccountStatus = {
  ACTIVE: 'active',
  INVALID: 'invalid',
  BLOCKED: 'blocked',
  DELETED: 'deleted',
} as const;

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const AppointmentStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export type AppointmentStatus =
  (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const AppointmentStatusReason = {
  DECLINED_BY_BABYSITTER: 'declined_by_babysitter',
  CANCELLED_BY_FAMILY: 'cancelled_by_family',
  CANCELLED_BY_BABYSITTER: 'cancelled_by_babysitter',
  ACCOUNT_DELETED: 'account_deleted',
  ADMIN_ACTION: 'admin_action',
} as const;

export type AppointmentStatusReason =
  (typeof AppointmentStatusReason)[keyof typeof AppointmentStatusReason];

export const SearchType = {
  ONE_TIME: 'one_time',
  RECURRING: 'recurring',
} as const;

export type SearchType = (typeof SearchType)[keyof typeof SearchType];

export const SearchStatus = {
  ACTIVE: 'active',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
} as const;

export type SearchStatus = (typeof SearchStatus)[keyof typeof SearchStatus];

export const ReferenceType = {
  MANUAL: 'manual',
  FAMILY_SUBMITTED: 'family_submitted',
} as const;

export type ReferenceType = (typeof ReferenceType)[keyof typeof ReferenceType];

export const ReferenceStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  PRIVATE: 'private',
  PUBLISHED: 'published',
  REMOVED: 'removed',
} as const;

export type ReferenceStatus =
  (typeof ReferenceStatus)[keyof typeof ReferenceStatus];

export const HolidayMode = {
  SAME: 'same',
  DIFFERENT: 'different',
  UNAVAILABLE: 'unavailable',
} as const;

export type HolidayMode = (typeof HolidayMode)[keyof typeof HolidayMode];

export const AreaMode = {
  ARRONDISSEMENT: 'arrondissement',
  DISTANCE: 'distance',
} as const;

export type AreaMode = (typeof AreaMode)[keyof typeof AreaMode];
