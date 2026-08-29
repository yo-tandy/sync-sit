import type { TaskCadence, TaskTiming } from '../types/task.js';
import {
  DO_AVAILABILITY_NOTE_MAX,
  DO_CADENCE_NOTE_MAX,
  DO_CADENCE_TIME_HINT_MAX,
  DO_DOER_BIO_MAX,
  DO_ENDORSEMENT_REF_NAME_MAX,
  DO_ENDORSEMENT_TEXT_MAX,
  DO_ENDORSEMENT_TEXT_MIN,
  DO_OFFER_MESSAGE_MAX,
  DO_PRICE_MAX,
  DO_PRICE_MIN,
  DO_TASK_DESCRIPTION_MAX,
  DO_TASK_PHOTOS_MAX,
  DO_TASK_TITLE_MAX,
} from '../constants/bounds.js';
import { computeTaskExpiresAt, type ExpiryTimingFields } from './expiry.js';
import { isTaskCategory } from './taxonomy.js';

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
 * `photoId` charset: the wizard mints UUIDs (§7.4's client-chosen return
 * leg), so the structural bound is safe-charset segments only. `uid` gets
 * the looser guard below — Firebase uids are opaque, but neither half may
 * ever smuggle a path.
 */
export const DO_PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const isSafePathSegment = (v: string): boolean =>
  v.length > 0 &&
  v.length <= 128 &&
  !v.includes('/') &&
  !v.includes('..') &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(v);

/**
 * `photos` — ≤ DO_TASK_PHOTOS_MAX entries, each a `{uid, photoId}` pair
 * (both halves of the storage path `do-photos/{uid}/{photoId}`, §4.1). The
 * caller-prefix OWNERSHIP check is `doPostTask`'s (§7.4), since it needs
 * the caller's uid — but the SHAPE is bounded here: `doGetTaskPhotoUrl`
 * signs the object name from these two fields via the Admin SDK, which
 * bypasses storage.rules entirely, so neither half may carry `/`, `..` or
 * control characters that would let a stored pair address a different
 * prefix than the one doPostTask verified.
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
      typeof (p as { photoId?: unknown }).photoId !== 'string'
    ) {
      return 'each photo must be a {uid, photoId} pair';
    }
    if (!isSafePathSegment((p as { uid: string }).uid)) {
      return 'photo uid is not a valid id';
    }
    if (!DO_PHOTO_ID_RE.test((p as { photoId: string }).photoId)) {
      return 'photo photoId is not a valid id';
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
  if (c.timeHint !== undefined && c.timeHint !== null) {
    if (typeof c.timeHint !== 'string') {
      return 'cadence.timeHint must be a string or null';
    }
    if (c.timeHint.length > DO_CADENCE_TIME_HINT_MAX) {
      return `cadence.timeHint must be at most ${DO_CADENCE_TIME_HINT_MAX} characters`;
    }
  }
  if (c.note !== undefined && c.note !== null) {
    if (typeof c.note !== 'string') {
      return 'cadence.note must be a string or null';
    }
    if (c.note.length > DO_CADENCE_NOTE_MAX) {
      return `cadence.note must be at most ${DO_CADENCE_NOTE_MAX} characters`;
    }
  }
  return null;
}

/** The offer's optional availability note (§4.2) — null allowed. */
export function validateAvailabilityNote(note: unknown): string | null {
  if (note === null) return null;
  if (typeof note !== 'string') {
    return 'availabilityNote must be a string or null';
  }
  if (note.length > DO_AVAILABILITY_NOTE_MAX) {
    return `availabilityNote must be at most ${DO_AVAILABILITY_NOTE_MAX} characters`;
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

const TIMING_FIELD_KEYS = [
  'date',
  'startTime',
  'endTime',
  'dueDate',
  'startDate',
  'endDate',
  'cadence',
] as const;

/**
 * Validates that exactly the fields of the `timing` model's group are
 * present and well-formed, and every other group's fields are absent:
 *
 * - `fixed`     → date + startTime + endTime; all else absent
 * - `deadline`  → dueDate; all else absent
 * - `recurring` → startDate + endDate + cadence; all else absent
 * - `ongoing`   → startDate + cadence, endDate absent (§4.1: "endDate:
 *                 recurring (null for ongoing)"); all else absent
 *
 * "Absent" means `null` OR omitted, equivalently, on both sides of the
 * check: callable payloads are JSON and JSON has no `undefined`, so a web
 * form posting a `fixed` task naturally omits `startDate`/`endDate`/
 * `cadence` rather than null-filling all seven fields. The stored TaskDoc
 * still writes explicit nulls (§4.1) — the callable normalizes.
 *
 * Takes `unknown` like the other validators and type-guards every field
 * itself: a non-string `startTime` must come back as this function's error
 * message (→ `invalid-argument`), never as a TypeError from deeper in
 * (→ `internal`).
 */
export function validateTaskTiming(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) {
    return 'timing fields must be an object';
  }
  const fields = input as Record<string, unknown>;
  const t = fields.timing;
  if (
    t !== 'fixed' &&
    t !== 'deadline' &&
    t !== 'recurring' &&
    t !== 'ongoing'
  ) {
    return 'timing must be fixed, deadline, recurring or ongoing';
  }

  // Which fields the model requires; everything else must be absent.
  const required: readonly (typeof TIMING_FIELD_KEYS)[number][] =
    t === 'fixed'
      ? ['date', 'startTime', 'endTime']
      : t === 'deadline'
        ? ['dueDate']
        : t === 'recurring'
          ? ['startDate', 'endDate', 'cadence']
          : ['startDate', 'cadence'];

  for (const key of TIMING_FIELD_KEYS) {
    const value = fields[key];
    if (required.includes(key)) {
      if (value === null || value === undefined) {
        return `${t} tasks need ${key}`;
      }
    } else if (value !== null && value !== undefined) {
      return `${t} tasks must not set ${key}`;
    }
  }

  // Well-formedness of the group's own fields. The typeof guards double as
  // the type check: a number where a string belongs gets the same message
  // as a junk string.
  const isDate = (v: unknown) => typeof v === 'string' && isCalendarDate(v);
  const isTime = (v: unknown) => typeof v === 'string' && isClockTime(v);
  if (t === 'fixed') {
    if (!isDate(fields.date)) return 'date is not a calendar date';
    if (!isTime(fields.startTime)) return 'startTime is not a valid time';
    if (!isTime(fields.endTime)) return 'endTime is not a valid time';
    // endTime <= startTime is LEGAL and means the task crosses midnight
    // (a 20:00–01:00 party clean-up) — the platform precedent is
    // publishSearch's one_time handling (PR #210 review), where an end at
    // or before the start belongs to the next calendar day. Deliberately
    // not the recurring range-order check's sibling.
  }
  if (t === 'deadline' && !isDate(fields.dueDate)) {
    return 'dueDate is not a calendar date';
  }
  if (t === 'recurring' || t === 'ongoing') {
    if (!isDate(fields.startDate)) {
      return 'startDate is not a calendar date';
    }
    if (t === 'recurring') {
      if (!isDate(fields.endDate)) {
        return 'endDate is not a calendar date';
      }
      if ((fields.endDate as string) < (fields.startDate as string)) {
        return 'endDate must not be before startDate';
      }
    }
    const cadenceErr = validateTaskCadence(fields.cadence);
    if (cadenceErr !== null) return cadenceErr;
  }
  return null;
}

/**
 * Rejects a dated task that is already over: a task whose computed expiry
 * (§6.3) is at or before `now` would publish, then vanish on the sweep's
 * next run with no error ever surfaced — the publishSearch precedent
 * ("The babysitting date is already past", `publishSearch.ts:138`) guards
 * this at the same layer. `doPostTask`/`doUpdateTask` (PR5) call it
 * server-side AFTER `validateTaskTiming` (the expiry computation throws on
 * a malformed timing group, so shape-validate first); the wizard calls it
 * with the client clock to pre-empt the round trip.
 *
 * Because expiry is end-of-day and midnight-crossing fixed tasks end on the
 * next day, "past" means the task's whole window is over — a 20:00–01:00
 * clean-up posted at 22:00 the same evening is still valid.
 * `ongoing` is never past (its expiry is `now + TTL` by construction).
 */
export function validateTaskTimingNotPast(
  fields: ExpiryTimingFields,
  now: Date,
): string | null {
  if (fields.timing === 'ongoing') return null;
  if (computeTaskExpiresAt(fields, now).getTime() <= now.getTime()) {
    return 'the task date is already past';
  }
  return null;
}

// ── Doer profile (§3.3 — doEnrollDoer / doUpdateDoerProfile) ──

/**
 * The digest category list: an array of DISTINCT sync-do categories.
 * Empty is valid — it means "no digests" by §3.3's always-explicit rule
 * (never "all"; `doEnrollDoer` states the all-categories default as data,
 * not as an empty-array convention).
 */
export function validateDoerCategories(categories: unknown): string | null {
  if (!Array.isArray(categories)) {
    return 'categories must be an array';
  }
  if (categories.some((c) => !isTaskCategory(c))) {
    return 'categories may only contain sync-do categories';
  }
  if (new Set(categories).size !== categories.length) {
    return 'categories may not repeat';
  }
  return null;
}

/** Free-text blurb shown to a family alongside an offer — null clears it. */
export function validateDoerBio(bio: unknown): string | null {
  if (bio === null) return null;
  if (typeof bio !== 'string' || bio.length > DO_DOER_BIO_MAX) {
    return `bio must be a string of at most ${DO_DOER_BIO_MAX} characters`;
  }
  return null;
}

/**
 * The optional default flat price hint (pre-fills the offer form) — null
 * clears it; a number obeys the shared price bounds.
 */
export function validateDoerDefaultRate(rate: unknown): string | null {
  if (rate === null) return null;
  const err = validatePrice(rate);
  return err === null
    ? null
    : `defaultRate must be null or a number between ${DO_PRICE_MIN} and ${DO_PRICE_MAX}`;
}

// ── Endorsements (decision 12, §9.1 — doSubmitEndorsement) ──

/**
 * The endorsement body. Trim-then-measure on BOTH bounds: whitespace must
 * neither satisfy the floor nor breach the ceiling, so what the validator
 * measures is exactly what the callable stores (it writes `.trim()`ed text).
 */
export function validateEndorsementText(text: unknown): string | null {
  if (typeof text !== 'string') {
    return 'referenceText is required';
  }
  const trimmed = text.trim();
  if (trimmed.length < DO_ENDORSEMENT_TEXT_MIN) {
    return `referenceText must be at least ${DO_ENDORSEMENT_TEXT_MIN} characters`;
  }
  if (trimmed.length > DO_ENDORSEMENT_TEXT_MAX) {
    return `referenceText must be at most ${DO_ENDORSEMENT_TEXT_MAX} characters`;
  }
  return null;
}

/** The submitting parent's own display name on the endorsement. */
export function validateEndorsementRefName(refName: unknown): string | null {
  if (typeof refName !== 'string' || refName.trim().length === 0) {
    return 'refName is required';
  }
  if (refName.trim().length > DO_ENDORSEMENT_REF_NAME_MAX) {
    return `refName must be at most ${DO_ENDORSEMENT_REF_NAME_MAX} characters`;
  }
  return null;
}

/** The doer's response to a pending endorsement (§9.2). */
export type DoEndorsementAction = 'accept' | 'decline';

export function isEndorsementAction(action: unknown): action is DoEndorsementAction {
  return action === 'accept' || action === 'decline';
}
