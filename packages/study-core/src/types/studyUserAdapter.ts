import type { User, LegacyUserFields } from '@ejm/shared-core';
import { getParentProfile, isAdmin } from '@ejm/shared-core';
import type { TutorProfile } from './tutorProfile.js';

// Dual-read adapters for sync-study (Plan D transition). See the shared-core
// userAdapter for the migration-window rationale. Sync-study is pre-launch
// so the legacy fallback should never fire in practice, but it's defined for
// symmetry and to keep the migration script honest.

/** Tutor-specific flat fields on a pre-Plan-D doc. */
interface LegacyTutorFields {
  ejemEmail?: string;
  classLevel?: string;
  gender?: TutorProfile['gender'];
  languages?: string[];
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  areaMode?: TutorProfile['areaMode'];
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: TutorProfile['areaLatLng'];
  areaRadiusKm?: number;
  subjects?: TutorProfile['subjects'];
  sessionLengthsMin?: number[];
  locationPrefs?: TutorProfile['locationPrefs'];
  paddingMin?: number;
  searchable?: boolean;
  lastRevalidatedAt?: TutorProfile['lastRevalidatedAt'];
  revalidationYear?: number;
}

type MaybeLegacy = User & Partial<LegacyUserFields> & Partial<LegacyTutorFields>;

export function getTutorProfile(
  user: MaybeLegacy | null | undefined,
): TutorProfile | undefined {
  if (!user) return undefined;
  if (user.profiles?.tutor) return user.profiles.tutor as TutorProfile;
  if (user.role !== 'tutor') return undefined;
  // Synthesize from legacy flat fields.
  return {
    enrollmentComplete: user.enrollmentComplete ?? false,
    ejemEmail: user.ejemEmail ?? '',
    classLevel: user.classLevel ?? '',
    gender: user.gender,
    languages: user.languages ?? [],
    aboutMe: user.aboutMe,
    contactEmail: user.contactEmail,
    contactPhone: user.contactPhone,
    whatsapp: user.whatsapp,
    areaMode: user.areaMode ?? 'arrondissement',
    arrondissements: user.arrondissements,
    areaAddress: user.areaAddress,
    areaLatLng: user.areaLatLng,
    areaRadiusKm: user.areaRadiusKm,
    subjects: user.subjects ?? [],
    sessionLengthsMin: user.sessionLengthsMin ?? [],
    locationPrefs: user.locationPrefs ?? [],
    paddingMin: user.paddingMin ?? 0,
    searchable: user.searchable,
    lastRevalidatedAt: user.lastRevalidatedAt,
    revalidationYear: user.revalidationYear,
  };
}

/**
 * Flattened tutor record: User base fields merged with the tutor profile —
 * equivalent to the pre-Plan-D flat tutor doc.
 */
export type TutorView = User & TutorProfile;

export function getTutorView(
  user: MaybeLegacy | null | undefined,
): TutorView | null {
  const profile = getTutorProfile(user);
  if (!user || !profile) return null;
  return { ...user, ...profile };
}

/** The user's role within sync-study, for routing and guards. */
export function getStudyRole(
  user: MaybeLegacy | null | undefined,
): 'tutor' | 'parent' | 'admin' | undefined {
  if (!user) return undefined;
  if (getTutorProfile(user)) return 'tutor';
  if (getParentProfile(user)) return 'parent';
  if (isAdmin(user)) return 'admin';
  return undefined;
}
