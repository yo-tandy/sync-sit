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

// ── Babysitter Enrollment ──

/** Immutable profile fields (step 2 of enrollment) */
export const babysitterImmutableProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  classLevel: z.string().min(1, 'Class is required'),
});

/** Full profile schema (backward compatible) */
export const babysitterProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  classLevel: z.string().min(1, 'Class is required'),
  languages: z.array(z.string()).min(1, 'Select at least one language'),
});

/** Check if a babysitter has all mandatory fields for activation */
export function isBabysitterProfileComplete(user: Record<string, unknown>): boolean {
  const languages = user.languages as string[] | undefined;
  const kidAgeRange = user.kidAgeRange as { min: number; max: number } | undefined;
  const hourlyRate = user.hourlyRate as number | undefined;
  const areaMode = user.areaMode as string | undefined;
  const arrondissements = user.arrondissements as string[] | undefined;
  const areaAddress = user.areaAddress as string | undefined;

  const hasLanguages = languages && languages.length > 0;
  const hasAgeRange = kidAgeRange && typeof kidAgeRange.min === 'number' && typeof kidAgeRange.max === 'number';
  const hasRate = typeof hourlyRate === 'number' && hourlyRate > 0;
  const hasArea = areaMode === 'distance'
    ? !!areaAddress
    : (arrondissements && arrondissements.length > 0);

  return !!(hasLanguages && hasAgeRange && hasRate && hasArea);
}

export const babysitterPreferencesSchema = z
  .object({
    kidAgeMin: z.number().min(0).max(18),
    kidAgeMax: z.number().min(0).max(18),
    maxKids: z.number().min(1).max(10),
    hourlyRate: z.number().min(0),
    aboutMe: z.string().optional(),
    contactEmail: z.string().email().optional().or(z.literal('')),
    contactPhone: z.string().optional(),
    areaMode: z.enum(['arrondissement', 'distance']),
    arrondissements: z.array(z.string()).optional(),
    areaAddress: z.string().optional(),
    areaRadiusKm: z.number().optional(),
  })
  .refine(
    (data) =>
      (data.contactEmail && data.contactEmail !== '') ||
      (data.contactPhone && data.contactPhone !== ''),
    { message: 'Provide at least one contact method (email or phone)' }
  )
  .refine((data) => data.kidAgeMin <= data.kidAgeMax, {
    message: 'Minimum age must be less than or equal to maximum age',
  });

export type BabysitterProfileInput = z.infer<typeof babysitterProfileSchema>;
export type BabysitterPreferencesInput = z.infer<typeof babysitterPreferencesSchema>;

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
