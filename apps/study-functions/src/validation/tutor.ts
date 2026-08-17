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
  rate: z.number().positive('Rate must be a positive number'),
});

// ── Tutor enrollment schemas ──

/**
 * Immutable profile data collected once at enrollment.
 * Mirrors the babysitter immutable-profile pattern: firstName, lastName,
 * dateOfBirth, classLevel (tutor's own graduation level), gender.
 * These fields cannot change after enrollment completes.
 *
 * The identity trio is OPTIONAL at the schema level (issue #144): a cross-app
 * add-profile caller already carries root identity on their user doc and the
 * wizard no longer re-collects it. Presence is enforced at the callable level:
 * new accounts must supply all three; add-profile callers may omit any field
 * the existing doc holds.
 */
export const tutorImmutableProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required').optional(),
  lastName: z.string().min(1, 'Last name is required').optional(),
  dateOfBirth: z.string().min(1, 'Date of birth is required').optional(), // "YYYY-MM-DD" string from client
  classLevel: z.string().min(1, 'Class level is required'), // tutor's own EJM class level
  gender: z
    .enum(['male', 'female', 'other', 'prefer_not_to_say'])
    .optional(),
});

/**
 * Subjects the tutor offers. At least one is REQUIRED at enrollment since
 * issue #143 made subjects the first collected step — a tutor with zero
 * subjects is invisible to search, and the floor belongs here, not only in
 * the wizard's client-side gate.
 */
export const tutorSubjectsSchema = z.object({
  subjects: z.array(subjectOfferingSchema).min(1, 'At least one subject is required'),
});

/**
 * Session preferences: which session lengths the tutor offers, location
 * preferences, appointment padding, about-me bio, and area/contact details.
 *
 * The signup wizard no longer collects these (issue #143) — every pref field
 * is optional here and enrollTutor applies server defaults. When a field IS
 * sent, the original bounds still apply (an explicit empty array is rejected,
 * only a missing field is defaulted).
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
    .min(1, 'At least one session length must be offered')
    .optional(),
  locationPrefs: z
    .array(z.enum(LOCATION_PREFS))
    .min(1, 'At least one location preference is required')
    .optional(),
  paddingMin: z
    .number()
    .int()
    .min(0, 'Padding must be >= 0')
    .max(60, 'Padding must be <= 60 minutes')
    .optional(),
  aboutMe: z.string().max(1000, 'About me must be 1000 characters or fewer').optional(),
  // Contact (at least one is required at the callable level; Zod marks both optional)
  contactEmail: z.string().email('Invalid contact email').optional(),
  contactPhone: z.string().optional(),
  whatsapp: z.string().optional(),
  // Area
  areaMode: z.enum(['arrondissement', 'distance']).optional(),
  arrondissements: z.array(z.string()).optional(),
  areaAddress: z.string().optional(),
  // Geocoded coordinates for the area address (distance mode). Bounds mirror the
  // searchTutors latLng schema — they also reject ±Infinity, which would yield
  // NaN haversine distances. searchTutors already tolerates a missing value.
  areaLatLng: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
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

// ── Enrollment pref defaults ──

export type TutorEnrollmentWithDefaults = TutorEnrollmentInput & {
  sessionLengthsMin: NonNullable<TutorEnrollmentInput['sessionLengthsMin']>;
  locationPrefs: NonNullable<TutorEnrollmentInput['locationPrefs']>;
  paddingMin: number;
  areaMode: NonNullable<TutorEnrollmentInput['areaMode']>;
  arrondissements: string[];
};

/**
 * Server defaults for the pref fields the signup wizard no longer collects
 * (issue #143). Defaults are applied only when the field is absent from the
 * payload — existing tutors' stored prefs are never rewritten. [60] is the
 * single most common session length; online-only is the minor-safe location
 * default; 30 min is the default appointment padding; arrondissement
 * mode with no arrondissements is the honest "area not set yet" state (the
 * tutor sets it at /tutor/area).
 */
export function withPrefDefaults(enrollment: TutorEnrollmentInput): TutorEnrollmentWithDefaults {
  return {
    ...enrollment,
    sessionLengthsMin: enrollment.sessionLengthsMin ?? [60],
    // ONLINE-ONLY default: the enrollee is a 15-18-year-old and the other
    // prefs are in-person-at-a-home options — they opt IN from the account
    // page, never get opted in by a default (reviewer flag on #145).
    locationPrefs: enrollment.locationPrefs ?? ['online'],
    paddingMin: enrollment.paddingMin ?? 30,
    areaMode: enrollment.areaMode ?? 'arrondissement',
    arrondissements: enrollment.arrondissements ?? [],
  };
}
