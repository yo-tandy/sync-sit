import { z } from 'zod';
import { DAYS_OF_WEEK } from '@ejm/shared-core';
import { SUBJECTS } from '../constants/subjects.js';
import { CLASS_LEVELS } from '../constants/classLevels.js';
import { SESSION_LENGTHS } from '../constants/sessionLengths.js';
import { LOCATION_PREFS } from '../constants/locationPrefs.js';

/**
 * Input schema for booking a tutoring session (the `bookSession` callable).
 *
 * Two shapes, discriminated by `type` (enforced in the superRefine below):
 *   • one_time  — a concrete `date` + `startTime`.
 *   • recurring — a weekly `recurringSlot` {day, startTime}; the concrete
 *     occurrence dates are derived server-side (never trusted from the client),
 *     `schoolWeeksOnly` (default true) drops French school-holiday weeks, and an
 *     optional `endDate` truncates the series.
 *
 * CONSCIOUS SCAFFOLD AMENDMENT: the scaffold's `recurringDayOfWeek: number` is
 * superseded by `recurringSlot.day` keyed on shared-core's DayOfWeek vocabulary
 * ('mon'..'sun') — the same keys the weekly grid, RecurringSlot, and the
 * availability engine already use, so no 0-6 ↔ key translation is needed.
 */
export const bookSessionInputSchema = z
  .object({
    // Conscious scaffold amendment: renamed tutorUid → tutorUserId and
    // sessionLengthMin → sessionLengthMinutes for cross-callable consistency —
    // every shipped study callable keys the tutor as `tutorUserId`, and
    // SessionDoc itself carries `sessionLengthMinutes`.
    tutorUserId: z.string().min(1, 'Tutor user ID is required'),
    subject: z.enum(SUBJECTS, {
      errorMap: () => ({ message: 'Subject must be one of the supported subjects' }),
    }),
    level: z.enum(CLASS_LEVELS, {
      errorMap: () => ({ message: 'Level must be one of the supported class levels' }),
    }),
    // one_time only (required when type === 'one_time'; see superRefine).
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
      .optional(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Start time must be in HH:MM format')
      .optional(),
    sessionLengthMinutes: z.union([
      z.literal(SESSION_LENGTHS[0]),
      z.literal(SESSION_LENGTHS[1]),
      z.literal(SESSION_LENGTHS[2]),
      z.literal(SESSION_LENGTHS[3]),
    ], {
      errorMap: () => ({
        message: `Session length must be one of: ${SESSION_LENGTHS.join(', ')} minutes`,
      }),
    }),
    location: z.enum(LOCATION_PREFS, {
      errorMap: () => ({ message: 'Location must be one of the supported location preferences' }),
    }),
    studentIds: z
      .array(z.string().min(1))
      .min(1, 'At least one student must be specified'),
    // Optional free-text note to the tutor.
    message: z.string().optional(),
    // Optional: address/latLng when location is family_home or tutor_home
    address: z.string().optional(),
    latLng: z
      .object({
        lat: z.number(),
        lng: z.number(),
      })
      .optional(),
    // ── Recurring ──
    type: z.enum(['one_time', 'recurring']).default('one_time'),
    // The weekly slot (required when type === 'recurring'; see superRefine). Its
    // endTime is derived server-side from startTime + sessionLengthMinutes.
    recurringSlot: z
      .object({
        day: z.enum(DAYS_OF_WEEK, {
          errorMap: () => ({ message: 'Recurring day must be one of mon..sun' }),
        }),
        startTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/, 'Start time must be in HH:MM format'),
      })
      .optional(),
    // Skip French school-holiday weeks entirely (default on).
    schoolWeeksOnly: z.boolean().optional().default(true),
    // Recurring only: flag the series' first materialized occurrence as a trial
    // (V1.1 feature 2). Like schoolWeeksOnly it lives top-level and is parsed on
    // ANY input; a one_time input carrying it is ACCEPTED but the flag is IGNORED
    // — only bookSession's recurring path persists it (omit-when-false). No
    // default: absence means "not a trial".
    trialFirstSession: z.boolean().optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format')
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'recurring') {
      if (!val.recurringSlot) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recurringSlot'],
          message: 'Recurring bookings require a weekly slot',
        });
      }
    } else {
      if (!val.date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['date'],
          message: 'Date is required for a one-time booking',
        });
      }
      if (!val.startTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['startTime'],
          message: 'Start time is required for a one-time booking',
        });
      }
    }
  });

export type BookSessionInput = z.infer<typeof bookSessionInputSchema>;

/**
 * Input schema for the `proposeSession` callable: a tutor proposes a concrete
 * one-time session to an approved, verified family (V1.1 feature 3). The
 * tutor-side mirror of a one_time bookSession — no `type` (one_time only, a
 * locked v1 decision), no `studentIds` (the family picks students at accept),
 * no recurring fields. `familyId` is the target family (validated against the
 * tutor's own approvedFamilies server-side).
 */
export const proposeSessionInputSchema = z.object({
  familyId: z.string().min(1, 'Family ID is required'),
  subject: z.enum(SUBJECTS, {
    errorMap: () => ({ message: 'Subject must be one of the supported subjects' }),
  }),
  level: z.enum(CLASS_LEVELS, {
    errorMap: () => ({ message: 'Level must be one of the supported class levels' }),
  }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Start time must be in HH:MM format'),
  sessionLengthMinutes: z.union([
    z.literal(SESSION_LENGTHS[0]),
    z.literal(SESSION_LENGTHS[1]),
    z.literal(SESSION_LENGTHS[2]),
    z.literal(SESSION_LENGTHS[3]),
  ], {
    errorMap: () => ({
      message: `Session length must be one of: ${SESSION_LENGTHS.join(', ')} minutes`,
    }),
  }),
  location: z.enum(LOCATION_PREFS, {
    errorMap: () => ({ message: 'Location must be one of the supported location preferences' }),
  }),
  message: z.string().optional(),
  address: z.string().optional(),
  latLng: z
    .object({ lat: z.number(), lng: z.number() })
    .optional(),
});

export type ProposeSessionInput = z.infer<typeof proposeSessionInputSchema>;

/**
 * Input schema for the `respondToSession` callable: the responding party
 * confirms or declines a pending session. For a family-initiated request the
 * TUTOR responds; for a tutor PROPOSAL (proposedBy === 'provider') the FAMILY
 * responds and MUST pass `studentIds` on confirm (they pick students at accept).
 * `studentIds` is ignored on a family-initiated confirm (the roster is already on
 * the doc from book time) — validated here as optional, enforced-when-required in
 * the callable so the exact code ('invalid-argument' when a proposal confirm omits
 * it) stays server-authoritative.
 */
export const respondToSessionSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  action: z.enum(['confirm', 'decline'], {
    errorMap: () => ({ message: "Action must be 'confirm' or 'decline'" }),
  }),
  studentIds: z
    .array(z.string().min(1))
    .min(1, 'At least one student must be specified')
    .optional(),
});

export type RespondToSessionInput = z.infer<typeof respondToSessionSchema>;

/**
 * Input schema for the `cancelSession` callable: the session's tutor OR a parent
 * of the session's family cancels a pending/confirmed session (one_time or the
 * whole recurring series). A reason is REQUIRED (≥3 chars after trimming) — the
 * counterparty is always told why.
 */
export const cancelSessionSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  reason: z
    .string()
    .trim()
    .min(3, 'A cancellation reason of at least 3 characters is required'),
});

export type CancelSessionInput = z.infer<typeof cancelSessionSchema>;

/**
 * Input schema for the `cancelSessionInstance` callable: cancel ONE occurrence
 * of a confirmed recurring series (the parent series stays live). Same party
 * model and reason requirement as cancelSession.
 */
export const cancelSessionInstanceSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  instanceId: z.string().min(1, 'Instance ID is required'),
  reason: z
    .string()
    .trim()
    .min(3, 'A cancellation reason of at least 3 characters is required'),
});

export type CancelSessionInstanceInput = z.infer<typeof cancelSessionInstanceSchema>;

/**
 * Input schema for the `setSessionNote` callable: a family member writes/edits
 * the pre-session note, or the tutor writes/edits the post-session note.
 *
 * `instanceId` is only meaningful for a recurring series (targets one occurrence);
 * a one_time session's notes live on the parent doc. `kind` selects which note
 * (and thus which party may write and which timing window applies). Empty `text`
 * (after trimming) is ALLOWED and clears the note (the field is deleted).
 */
export const setSessionNoteSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  instanceId: z.string().min(1).optional(),
  kind: z.enum(['pre', 'post'], {
    errorMap: () => ({ message: "Note kind must be 'pre' or 'post'" }),
  }),
  text: z
    .string()
    .trim()
    .max(2000, 'A session note may be at most 2000 characters'),
});

export type SetSessionNoteInput = z.infer<typeof setSessionNoteSchema>;

/**
 * Input for the modifySession callable (issue #234, parity A1: sit's
 * modifyAppointment adapted to study). Everything but sessionId is optional --
 * the callable diffs against the stored doc and refuses a no-op. one_time
 * sessions only (a recurring series is regenerated instances + per-occurrence
 * ledger claims; mutating it in place is its own feature).
 *
 * Deliberate deltas from sit's contract, decided in the plan doc:
 *  - `date` IS modifiable (moving the day is THE reschedule);
 *  - `rate` is NOT (study's rate is the tutor's locked-in offering, not a
 *    family-set offer like sit's offeredRate).
 */
export const modifySessionSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Start time must be in HH:MM format')
    .optional(),
  sessionLengthMinutes: z
    .union(
      [
        z.literal(SESSION_LENGTHS[0]),
        z.literal(SESSION_LENGTHS[1]),
        z.literal(SESSION_LENGTHS[2]),
        z.literal(SESSION_LENGTHS[3]),
      ],
      {
        errorMap: () => ({
          message: `Session length must be one of: ${SESSION_LENGTHS.join(', ')} minutes`,
        }),
      },
    )
    .optional(),
  location: z
    .enum(LOCATION_PREFS, {
      errorMap: () => ({ message: 'Location must be one of the supported location preferences' }),
    })
    .optional(),
  studentIds: z.array(z.string().min(1)).min(1, 'At least one student must be specified').optional(),
  message: z.string().trim().max(2000).optional(),
});

export type ModifySessionInput = z.infer<typeof modifySessionSchema>;

/** Input for acknowledgeSessionModification (tutor-only; sit's acknowledgeModification twin). */
export const acknowledgeSessionModificationSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
});
