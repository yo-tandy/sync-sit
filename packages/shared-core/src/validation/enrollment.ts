import { z } from 'zod';

// ── Password Validation ──

export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

/** Check password requirements individually (for UI feedback) */
export function checkPasswordRequirements(password: string) {
  return {
    minLength: password.length >= 8,
    hasLowercase: /[a-z]/.test(password),
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };
}

// ── Parent/Family Enrollment ──

export const kidSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  age: z.number().min(0).max(18),
  languages: z.array(z.string()).min(1, 'Select at least one language'),
});

export const familyEnrollmentSchema = z.object({
  familyName: z.string().min(1, 'Family name is required'),
  lastName: z.string().optional(), // if different from family name
  firstName: z.string().min(1, 'First name is required'),
  address: z.string().min(1, 'Address is required'),
  pets: z.string().optional(),
  note: z.string().optional(),
  kids: z.array(kidSchema).optional(),
});

// NOTE: field names (minBabysitterAge, maxRate) are babysitter-flavored but
// the schema is structurally generic. Agent 4 may generalize these for
// sync-study (e.g. minProviderAge) when wiring tutor search; until then both
// apps reuse this schema as-is.
export const searchDefaultsSchema = z.object({
  minBabysitterAge: z.number().optional(),
  preferredGender: z.string().optional(),
  requireReferences: z.boolean().optional(),
  maxRate: z.number().optional(),
});

export const joinFamilySchema = z.object({
  lastName: z.string().optional(),
  firstName: z.string().min(1, 'First name is required'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type KidInput = z.infer<typeof kidSchema>;
export type FamilyEnrollmentInput = z.infer<typeof familyEnrollmentSchema>;
export type SearchDefaultsInput = z.infer<typeof searchDefaultsSchema>;
export type JoinFamilyInput = z.infer<typeof joinFamilySchema>;
