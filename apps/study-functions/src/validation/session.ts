import { z } from 'zod';
import { SUBJECTS } from '../constants/subjects.js';
import { CLASS_LEVELS } from '../constants/classLevels.js';
import { SESSION_LENGTHS } from '../constants/sessionLengths.js';
import { LOCATION_PREFS } from '../constants/locationPrefs.js';

/**
 * Input schema for booking a tutoring session (the `bookSession` callable).
 *
 * Recurring bookings are gated OFF in this PR (PR 3 wires them): the recurring
 * fields remain in the shape so the schema is forward-compatible, but a
 * `type: 'recurring'` input is rejected by the superRefine below.
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
    // Recurring fields (gated off this PR — see superRefine)
    type: z.enum(['one_time', 'recurring']).default('one_time'),
    recurringDayOfWeek: z.number().int().min(0).max(6).optional(),
    schoolWeeksOnly: z.boolean().optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format')
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'recurring') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'Recurring booking is not yet available',
      });
    }
  });

export type BookSessionInput = z.infer<typeof bookSessionInputSchema>;
