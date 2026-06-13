import type { FirestoreTimestamp, LatLng, ProfileBase, ParentProfile, User, AreaMode } from '@ejm/shared-core';

/**
 * Sync-sit babysitter profile. Lives at users/{uid}.profiles.babysitter
 * in the Plan D portable-user schema.
 */
export interface BabysitterProfile extends ProfileBase {
  // Identity (EJM-side)
  ejemEmail: string;
  classLevel: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  languages: string[];
  aboutMe?: string;

  // Contact (at least one required by enrollment)
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;

  // Area
  areaMode: AreaMode;
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: LatLng;
  areaRadiusKm?: number;

  // Babysitter-specific preferences
  kidAgeRange: { min: number; max: number };
  maxKids: number;
  hourlyRate: number;
  contactSharingConsent?: boolean;
  approvedFamilies?: string[];

  // Search visibility
  searchable?: boolean;

  // Revalidation
  lastRevalidatedAt?: FirestoreTimestamp;
  revalidationYear?: number;
}

/**
 * Narrowed User for sync-sit. Only the babysitter + parent profile slots
 * are observable here; sync-study's tutor profile may or may not be present
 * on the underlying document but is opaque from sync-sit's perspective.
 */
export interface SitUser extends User {
  profiles: {
    babysitter?: BabysitterProfile;
    parent?: ParentProfile;
  };
}
