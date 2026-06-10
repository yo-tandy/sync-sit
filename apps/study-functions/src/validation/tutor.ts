import { z } from 'zod';
import { SUBJECTS } from '../constants/subjects.js';
import { CLASS_LEVELS } from '../constants/classLevels.js';
import { SESSION_LENGTHS } from '../constants/sessionLengths.js';
import { LOCATION_PREFS } from '../constants/locationPrefs.js';

// ── Sub-schemas ──

const subjectOfferingSchema = z.object({
  subject: z.enum(SUBJECTS, {
    errorMap: () => ({ message: 'Subject must be one of the supported subjects' }),
  }),
  levels: z
    .array(z.enum(CLASS_LEVELS))
    .min(1, 'At least one class level is required per subject'),
  rate: z.number().min(0, 'Rate must be a non-negative number'),
});

// ── Tutor enrollment schemas ──

/**
 * Immutable profile data collected once at enrollment.
 * Mirrors the babysitter immutable-profile pattern: firstName, lastName,
 * dateOfBirth, classLevel (tutor's own graduation level), gender.
 * These fields cannot change after enrollment completes.
 */
export const tutorImmutableProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'), // "YYYY-MM-DD" string from client
  classLevel: z.string().min(1, 'Class level is required'), // tutor's own EJM class level
  gender: z
    .enum(['male', 'female', 'other', 'prefer_not_to_say'])
    .optional(),
});

/**
 * Subjects the tutor offers. Empty array is valid — subjects are deferred to
 * the profile-edit flow after enrollment completes.
 */
export const tutorSubjectsSchema = z.object({
  subjects: z.array(subjectOfferingSchema),
});

/**
 * Session preferences: which session lengths the tutor offers, location
 * preferences, transit padding, about-me bio, and area/contact details.
 */
export const tutorSessionPrefsSchema = z.object({
  sessionLengthsMin: z
    .array(
      z
        .number()
        .int()
        .refine(
          (v): v is (typeof SESSION_LENGTHS)[number] =>
            (SESSION_LENGTHS as readonly number[]).includes(v),
          { message: `Session length must be one of: ${SESSION_LENGTHS.join(', ')} minutes` },
        ),
    )
    .min(1, 'At least one session length must be offered'),
  locationPrefs: z
    .array(z.enum(LOCATION_PREFS))
    .min(1, 'At least one location preference is required'),
  paddingMin: z
    .number()
    .int()
    .min(0, 'Padding must be >= 0')
    .max(60, 'Padding must be <= 60 minutes'),
  aboutMe: z.string().max(1000, 'About me must be 1000 characters or fewer').optional(),
  // Contact (at least one is required at the callable level; Zod marks both optional)
  contactEmail: z.string().email('Invalid contact email').optional(),
  contactPhone: z.string().optional(),
  whatsapp: z.string().optional(),
  // Area
  areaMode: z.enum(['arrondissement', 'distance']),
  arrondissements: z.array(z.string()).optional(),
  areaAddress: z.string().optional(),
  areaRadiusKm: z.number().min(0).max(50).optional(),
});

/**
 * Full tutor enrollment payload — composition of all three steps.
 * The callable that receives this must additionally verify that at least
 * one contact field is present.
 */
export const tutorEnrollmentSchema = tutorImmutableProfileSchema
  .merge(tutorSubjectsSchema)
  .merge(tutorSessionPrefsSchema);

// ── Inferred types ──

export type TutorImmutableProfileInput = z.infer<typeof tutorImmutableProfileSchema>;
export type TutorSubjectsInput = z.infer<typeof tutorSubjectsSchema>;
export type TutorSessionPrefsInput = z.infer<typeof tutorSessionPrefsSchema>;
export type TutorEnrollmentInput = z.infer<typeof tutorEnrollmentSchema>;
