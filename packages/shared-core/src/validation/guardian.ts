import { z } from 'zod';

// ── Guardian (parental governance) input validation ──

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(80, 'Name is too long');

/** "YYYY-MM-DD" that parses to a real calendar date. */
export const isoDateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Date of birth is not a real date');

/** Parent-entered kid identity on createKidInvite / correctChildIdentity. */
export const kidIdentitySchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  dateOfBirth: isoDateOfBirthSchema,
});

/** Consent versions the caller approved; compared to the current constants. */
export const guardianConsentInputSchema = z.object({
  tosVersion: z.string().min(1, 'Consent is required'),
  privacyVersion: z.string().min(1, 'Consent is required'),
  supervisionAgreementVersion: z.string().min(1, 'Consent is required'),
});

export type GuardianConsentInput = z.infer<typeof guardianConsentInputSchema>;
