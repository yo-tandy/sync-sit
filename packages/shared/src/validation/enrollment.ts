import { z } from 'zod';
import { LANGUAGES, ALL_AREAS } from '../constants/config.js';

// ── Babysitter Enrollment ──

export const babysitterProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  classLevel: z.string().min(1, 'Class is required'),
  languages: z.array(z.string()).min(1, 'Select at least one language'),
});

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
  kids: z.array(kidSchema).min(1, 'Add at least one child'),
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
