import type { TaskCadence, TaskTiming } from '../types/task.js';
import {
  DO_OFFER_MESSAGE_MAX,
  DO_PRICE_MAX,
  DO_PRICE_MIN,
  DO_TASK_DESCRIPTION_MAX,
  DO_TASK_PHOTOS_MAX,
  DO_TASK_TITLE_MAX,
} from '../constants/bounds.js';

/**
 * Pure validators for sync-do input (plan §8: "manual guards … with the
 * shared bounds exported from do-core so the frontend enforces the same
 * numbers"). Each returns an error MESSAGE string, or null when valid —
 * callables wrap a non-null result in
 * `HttpsError('invalid-argument', message)` (the publishSearch house
 * style), and the web forms render it inline to pre-empt the round trip.
 * do-core deliberately never imports firebase-functions: this is a leaf
 * package the frontend consumes too.
 */

export const DO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DO_TIME_RE = /^\d{2}:\d{2}$/;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Shape regexes pass '2026-13-45' — bound to the calendar so junk stays on
 * the invalid-argument path (the publishSearch round-trip guard).
 */
export function isCalendarDate(value: string): boolean {
  if (!DO_DATE_RE.test(value)) return false;
  const roundTrip = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(roundTrip.getTime()) &&
    roundTrip.toISOString().slice(0, 10) === value
  );
}

/** 'HH:MM' bounded to the clock ('25:99' fails the same way). */
export function isClockTime(value: string): boolean {
  if (!DO_TIME_RE.test(value)) return false;
  const [hh, mm] = value.split(':').map(Number);
  return hh <= 23 && mm <= 59;
}

// ── Length bounds (§4.1, §4.2) ──

export function validateTaskTitle(title: unknown): string | null {
  if (typeof title !== 'string' || title.trim().length === 0) {
    return 'title is required';
  }
  if (title.length > DO_TASK_TITLE_MAX) {
    return `title must be at most ${DO_TASK_TITLE_MAX} characters`;
  }
  return null;
}

export function validateTaskDescription(description: unknown): string | null {
  if (typeof description !== 'string' || description.trim().length === 0) {
    return 'description is required';
  }
  if (description.length > DO_TASK_DESCRIPTION_MAX) {
    return `description must be at most ${DO_TASK_DESCRIPTION_MAX} characters`;
  }
  return null;
}

export function validateOfferMessage(message: unknown): string | null {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return 'message is required';
  }
  if (message.length > DO_OFFER_MESSAGE_MAX) {
    return `message must be at most ${DO_OFFER_MESSAGE_MAX} characters`;
  }
  return null;
}

/**
 * `photos` — ≤ DO_TASK_PHOTOS_MAX entries, each a `{uid, photoId}` pair
 * (both halves of the storage path `do-photos/{uid}/{photoId}`, §4.1). Shape
 * only: the caller-prefix ownership check is `doPostTask`'s (§7.4), since it
 * needs the caller's uid.
 */
export function validateTaskPhotos(photos: unknown): string | null {
  if (!Array.isArray(photos)) {
    return 'photos must be an array';
  }
  if (photos.length > DO_TASK_PHOTOS_MAX) {
    return `at most ${DO_TASK_PHOTOS_MAX} photos`;
  }
  for (const p of photos) {
    if (
      typeof p !== 'object' ||
      p === null ||
      typeof (p as { uid?: unknown }).uid !== 'string' ||
      ((p as { uid: string }).uid).length === 0 ||
      typeof (p as { photoId?: unknown }).photoId !== 'string' ||
      ((p as { photoId: string }).photoId).length === 0
    ) {
      return 'each photo must be a {uid, photoId} pair';
    }
  }
  return null;
}

// ── Price bounds (§4.2 offer price / §4.1 suggestedBudget, EUR) ──

export function validatePrice(price: unknown): string | null {
  if (
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price < DO_PRICE_MIN ||
    price > DO_PRICE_MAX
  ) {
    return `price must be a number between ${DO_PRICE_MIN} and ${DO_PRICE_MAX}`;
  }
  return null;
}

/** The task's optional indication — null allowed; the OFFER sets the price. */
export function validateSuggestedBudget(budget: unknown): string | null {
  if (budget === null) return null;
  const err = validatePrice(budget);
  return err === null
    ? null
    : `suggestedBudget must be null or a number between ${DO_PRICE_MIN} and ${DO_PRICE_MAX}`;
}

export function validatePriceBasis(basis: unknown): string | null {
  if (basis !== 'flat' && basis !== 'hourly') {
    return 'priceBasis must be flat or hourly';
  }
  return null;
}

/** Decision 9: the optional +1 helper — name and age, or null. */
export function validateOfferHelper(helper: unknown): string | null {
  if (helper === null) return null;
  if (typeof helper !== 'object') {
    return 'helper must be null or {firstName, lastName, age}';
  }
  const h = helper as { firstName?: unknown; lastName?: unknown; age?: unknown };
  if (
    typeof h.firstName !== 'string' ||
    h.firstName.trim().length === 0 ||
    typeof h.lastName !== 'string' ||
    h.lastName.trim().length === 0
  ) {
    return 'helper needs a first and last name';
  }
  if (
    typeof h.age !== 'number' ||
    !Number.isInteger(h.age) ||
    h.age < 1 ||
    h.age > 120
  ) {
    return 'helper age must be a whole number';
  }
  return null;
}

/** The family's honest guess, any timing — null allowed. */
export function validateEstimatedHours(hours: unknown): string | null {
  if (hours === null) return null;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
    return 'estimatedHours must be null or a positive number';
  }
  return null;
}

// ── Cadence (§4.1 TaskCadence) ──

export function validateTaskCadence(cadence: unknown): string | null {
  if (typeof cadence !== 'object' || cadence === null) {
    return 'cadence must be an object';
  }
  const c = cadence as TaskCadence;
  if (c.kind !== 'daily' && c.kind !== 'weekly' && c.kind !== 'custom') {
    return 'cadence.kind must be daily, weekly or custom';
  }
  if (c.days !== undefined) {
    if (
      !Array.isArray(c.days) ||
      c.days.some((d) => !DAY_KEYS.includes(d)) ||
      new Set(c.days).size !== c.days.length
    ) {
      return 'cadence.days must be unique day keys (sun..sat)';
    }
  }
  if (c.kind === 'weekly' && (!c.days || c.days.length === 0)) {
    return 'weekly cadence needs at least one day';
  }
  if (
    c.kind === 'custom' &&
    (typeof c.note !== 'string' || c.note.trim().length === 0)
  ) {
    return 'custom cadence needs a note';
  }
  if (
    c.timeHint !== undefined &&
    c.timeHint !== null &&
    typeof c.timeHint !== 'string'
  ) {
    return 'cadence.timeHint must be a string or null';
  }
  if (c.note !== undefined && c.note !== null && typeof c.note !== 'string') {
    return 'cadence.note must be a string or null';
  }
  return null;
}

// ── The timing discriminant (§4.1: "discriminated by `timing`; exactly one
// group is non-null") ──

/** The when-group of TaskDoc, as submitted to doPostTask / doUpdateTask. */
export interface TaskTimingFields {
  timing: TaskTiming;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  dueDate: string | null;
  startDate: string | null;
  endDate: string | null;
  cadence: TaskCadence | null;
}

/**
 * Validates that exactly the fields of the `timing` model's group are
 * non-null and well-formed, and every other group's fields are null:
 *
 * - `fixed`     → date + startTime + endTime; all else null
 * - `deadline`  → dueDate; all else null
 * - `recurring` → startDate + endDate + cadence; all else null
 * - `ongoing`   → startDate + cadence, endDate null (§4.1: "endDate:
 *                 recurring (null for ongoing)"); all else null
 */
export function validateTaskTiming(fields: TaskTimingFields): string | null {
  const t = fields.timing;
  if (
    t !== 'fixed' &&
    t !== 'deadline' &&
    t !== 'recurring' &&
    t !== 'ongoing'
  ) {
    return 'timing must be fixed, deadline, recurring or ongoing';
  }

  // Which fields the model requires; everything else must be null.
  const required: (keyof Omit<TaskTimingFields, 'timing'>)[] =
    t === 'fixed'
      ? ['date', 'startTime', 'endTime']
      : t === 'deadline'
        ? ['dueDate']
        : t === 'recurring'
          ? ['startDate', 'endDate', 'cadence']
          : ['startDate', 'cadence'];

  const all: (keyof Omit<TaskTimingFields, 'timing'>)[] = [
    'date',
    'startTime',
    'endTime',
    'dueDate',
    'startDate',
    'endDate',
    'cadence',
  ];
  for (const key of all) {
    const value = fields[key];
    if (required.includes(key)) {
      if (value === null || value === undefined) {
        return `${t} tasks need ${key}`;
      }
    } else if (value !== null) {
      return `${t} tasks must not set ${key}`;
    }
  }

  // Well-formedness of the group's own fields.
  if (t === 'fixed') {
    if (!isCalendarDate(fields.date!)) return 'date is not a calendar date';
    if (!isClockTime(fields.startTime!)) return 'startTime is not a valid time';
    if (!isClockTime(fields.endTime!)) return 'endTime is not a valid time';
  }
  if (t === 'deadline' && !isCalendarDate(fields.dueDate!)) {
    return 'dueDate is not a calendar date';
  }
  if (t === 'recurring' || t === 'ongoing') {
    if (!isCalendarDate(fields.startDate!)) {
      return 'startDate is not a calendar date';
    }
    if (t === 'recurring') {
      if (!isCalendarDate(fields.endDate!)) {
        return 'endDate is not a calendar date';
      }
      if (fields.endDate! < fields.startDate!) {
        return 'endDate must not be before startDate';
      }
    }
    const cadenceErr = validateTaskCadence(fields.cadence);
    if (cadenceErr !== null) return cadenceErr;
  }
  return null;
}
