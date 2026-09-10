import { z } from 'zod';
import { LYCEE_CLASS_LEVELS } from '../constants/classLevels.js';

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
  // Geocoder components of the picked address (issue #167): persisted on the
  // family doc so tutor coverage-area matching can resolve the family's
  // arrondissement/town without a re-pick in search. Optional — legacy
  // clients and hand-typed addresses send neither.
  postcode: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  pets: z.string().optional(),
  note: z.string().optional(),
  kids: z.array(kidSchema).optional(),
  // Consent-document version the enrolling client presented (issue #178:
  // study's wizard shows '2025-12-01', sit's shows '1.0'). ALLOWLIST, not a
  // free string — this lands verbatim in the canonical consent record, so
  // only versions of terms that actually shipped are acceptable. When terms
  // are re-versioned, add the new version here. Optional — legacy sit
  // clients send nothing and the server defaults to '1.0', keeping their
  // behavior byte-identical.
  consentVersion: z.enum(['1.0', '2025-12-01']).optional(),
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

// ── Unified student-identity enrollment (issue #435 milestone, PR4) ──
//
// The common student flow (apps/web `/enroll/student`) collects a full
// identity — name/DOB/classLevel/gender/contact/optional extras — BEFORE the
// user picks sit or study, mirroring `enrollBabysitter`'s/`enrollTutor`'s
// classic new-account payload shape but with no role-specific fields at all
// (those come later, from whichever provider callable the "choose your app"
// screen calls with `crossApp: true`). `enrollStudentIdentity`
// (`@ejm/shared-functions`) validates against this schema.
const addressShape = z.object({
  fullAddress: z.string().min(1),
  street: z.string(),
  city: z.string(),
  postcode: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export const studentIdentityEnrollmentSchema = z.object({
  ejemEmail: z.string().email('Please enter a valid email'),
  verificationCode: z.string().min(1, 'Verification code is required'),
  password: strongPasswordSchema,
  consentVersion: z.string().min(1, 'Consent is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  // "YYYY-MM-DD", matching the classic wizards' wire format.
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  classLevel: z.enum(LYCEE_CLASS_LEVELS),
  gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']),
  // At least one of email/phone is enforced in the callable (matches
  // enrollTutor's "at least one contact field" rule) — both individually
  // optional here so the zod error never fires before that clearer check.
  contactEmail: z.string().email('Enter a full email address').optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  whatsapp: z.string().nullable().optional(),
  bio: z.string().max(1000).optional(),
  address: addressShape.nullable().optional(),
  language: z.enum(['en', 'fr']).optional(),
  // StepContactInfo's contact-visibility consent checkbox — recorded on the
  // root doc so the sit/study crossApp callables can read it later (see the
  // `User.contactVisibilityConsent` doc comment).
  contactVisibilityConsent: z.boolean().optional(),
});

export type StudentIdentityEnrollmentInput = z.infer<typeof studentIdentityEnrollmentSchema>;
