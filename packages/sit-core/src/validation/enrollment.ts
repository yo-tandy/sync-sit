import { z } from 'zod';

// Re-export the cross-app schemas (password, kid, family, search, joinFamily)
// so consumers importing from '@ejm/sit-core' still see the full surface.
export * from '@ejm/shared-core';

// ── Babysitter Enrollment (babysitter-specific) ──

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
  const maxKids = user.maxKids as number | undefined;
  const hourlyRate = user.hourlyRate as number | undefined;
  const areaMode = user.areaMode as string | undefined;
  const arrondissements = user.arrondissements as string[] | undefined;
  const areaAddress = user.areaAddress as string | undefined;

  const hasLanguages = languages && languages.length > 0;
  const hasAgeRange = kidAgeRange && typeof kidAgeRange.min === 'number' && typeof kidAgeRange.max === 'number';
  const hasMaxKids = typeof maxKids === 'number' && maxKids > 0;
  const hasRate = typeof hourlyRate === 'number' && hourlyRate > 0;
  const hasArea = areaMode === 'distance'
    ? !!areaAddress
    : (arrondissements && arrondissements.length > 0);

  return !!(hasLanguages && hasAgeRange && hasMaxKids && hasRate && hasArea);
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
