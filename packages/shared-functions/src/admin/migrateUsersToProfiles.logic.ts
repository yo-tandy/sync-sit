/**
 * Pure, SDK-free transform logic for the Plan D user migration. Kept separate
 * from the callable (which imports the Firestore admin SDK) so it can be
 * unit-tested without initializing firebase-admin.
 */

export type LegacyRole = 'babysitter' | 'parent' | 'tutor' | 'admin';

export interface LegacyUserDoc {
  role?: LegacyRole;
  enrollmentComplete?: boolean;
  familyId?: string;
  // Babysitter / tutor shared flat fields
  ejemEmail?: unknown;
  classLevel?: unknown;
  gender?: unknown;
  languages?: unknown;
  aboutMe?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  whatsapp?: unknown;
  areaMode?: unknown;
  arrondissements?: unknown;
  areaAddress?: unknown;
  areaLatLng?: unknown;
  areaRadiusKm?: unknown;
  // Babysitter-specific
  kidAgeRange?: unknown;
  maxKids?: unknown;
  hourlyRate?: unknown;
  contactSharingConsent?: unknown;
  approvedFamilies?: unknown;
  searchable?: unknown;
  lastRevalidatedAt?: unknown;
  revalidationYear?: unknown;
  // Tutor-specific
  subjects?: unknown;
  sessionLengthsMin?: unknown;
  locationPrefs?: unknown;
  paddingMin?: unknown;
}

/** Legacy flat keys shared by the babysitter + tutor profiles. */
const SHARED_PROFILE_KEYS = [
  'ejemEmail', 'classLevel', 'gender', 'languages', 'aboutMe',
  'contactEmail', 'contactPhone', 'whatsapp', 'areaMode', 'arrondissements',
  'areaAddress', 'areaLatLng', 'areaRadiusKm', 'searchable',
  'lastRevalidatedAt', 'revalidationYear',
] as const;

export const BABYSITTER_KEYS = [
  ...SHARED_PROFILE_KEYS,
  'kidAgeRange', 'maxKids', 'hourlyRate', 'contactSharingConsent', 'approvedFamilies',
] as const;

export const TUTOR_KEYS = [
  ...SHARED_PROFILE_KEYS,
  'subjects', 'sessionLengthsMin', 'locationPrefs', 'paddingMin',
] as const;

/** Copy only the defined legacy keys into a profile object (Firestore rejects undefined). */
export function buildProfile(
  data: LegacyUserDoc,
  keys: readonly string[],
): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    enrollmentComplete: data.enrollmentComplete ?? false,
  };
  for (const key of keys) {
    const value = (data as Record<string, unknown>)[key];
    if (value !== undefined) profile[key] = value;
  }
  return profile;
}

/**
 * Given a legacy user doc, compute the Firestore update that lifts it into the
 * Plan D shape, or `null` if it has no top-level `role` (already migrated /
 * never had one). `deleteFields` lists the legacy keys to remove; the callable
 * maps them to FieldValue.delete().
 */
export function buildMigrationUpdate(
  data: LegacyUserDoc,
): { set: Record<string, unknown>; deleteFields: string[] } | null {
  if (!data.role) return null;

  const set: Record<string, unknown> = {};
  const deleteFields: string[] = ['role'];

  if (data.role === 'babysitter') {
    set['profiles.babysitter'] = buildProfile(data, BABYSITTER_KEYS);
    deleteFields.push(...BABYSITTER_KEYS, 'enrollmentComplete');
  } else if (data.role === 'parent') {
    set['profiles.parent'] = {
      enrollmentComplete: data.enrollmentComplete ?? true,
      familyId: data.familyId ?? '',
    };
    deleteFields.push('familyId', 'enrollmentComplete');
  } else if (data.role === 'tutor') {
    set['profiles.tutor'] = buildProfile(data, TUTOR_KEYS);
    deleteFields.push(...TUTOR_KEYS, 'enrollmentComplete');
  } else if (data.role === 'admin') {
    set.isAdmin = true;
  }

  return { set, deleteFields };
}
