import type { User, LegacyUserFields } from '@ejm/shared-core';
import { getParentProfile, isAdmin } from '@ejm/shared-core';
import type { BabysitterProfile } from './babysitterProfile.js';

// Dual-read adapters for sync-sit (Plan D transition). See the shared-core
// userAdapter for the migration-window rationale. The legacy fallback
// branches are deleted in a follow-up PR after prod migration.

/** Babysitter-specific flat fields on a pre-Plan-D doc. */
interface LegacyBabysitterFields {
  ejemEmail?: string;
  classLevel?: string;
  gender?: BabysitterProfile['gender'];
  languages?: string[];
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  areaMode?: BabysitterProfile['areaMode'];
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: BabysitterProfile['areaLatLng'];
  areaRadiusKm?: number;
  kidAgeRange?: BabysitterProfile['kidAgeRange'];
  maxKids?: number;
  hourlyRate?: number;
  contactSharingConsent?: boolean;
  approvedFamilies?: string[];
  searchable?: boolean;
  lastRevalidatedAt?: BabysitterProfile['lastRevalidatedAt'];
  revalidationYear?: number;
}

type MaybeLegacy = User & Partial<LegacyUserFields> & Partial<LegacyBabysitterFields>;

export function getBabysitterProfile(
  user: MaybeLegacy | null | undefined,
): BabysitterProfile | undefined {
  if (!user) return undefined;
  if (user.profiles?.babysitter) return user.profiles.babysitter as BabysitterProfile;
  if (user.role !== 'babysitter') return undefined;
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
    kidAgeRange: user.kidAgeRange ?? { min: 0, max: 0 },
    maxKids: user.maxKids ?? 0,
    hourlyRate: user.hourlyRate ?? 0,
    contactSharingConsent: user.contactSharingConsent,
    approvedFamilies: user.approvedFamilies,
    searchable: user.searchable,
    lastRevalidatedAt: user.lastRevalidatedAt,
    revalidationYear: user.revalidationYear,
  };
}

/**
 * Flattened babysitter record: User base fields merged with the babysitter
 * profile — equivalent to the pre-Plan-D flat babysitter doc. Lets consumer
 * code that reads both user-level and babysitter-level fields off one object
 * migrate with a one-line swap.
 */
export type BabysitterView = User & BabysitterProfile;

export function getBabysitterView(
  user: MaybeLegacy | null | undefined,
): BabysitterView | null {
  const profile = getBabysitterProfile(user);
  if (!user || !profile) return null;
  return { ...user, ...profile };
}

/** The user's role within sync-sit, for routing and guards. */
export function getSitRole(
  user: MaybeLegacy | null | undefined,
): 'babysitter' | 'parent' | 'admin' | undefined {
  if (!user) return undefined;
  if (getBabysitterProfile(user)) return 'babysitter';
  if (getParentProfile(user)) return 'parent';
  if (isAdmin(user)) return 'admin';
  return undefined;
}
