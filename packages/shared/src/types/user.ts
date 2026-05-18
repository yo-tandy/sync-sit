import type { ServiceProviderBase, ParentUser, AdminUser } from '@ejm/shared-core';

// Re-export the generic user types so consumers importing from '@ejm/shared'
// still see the full surface (UserBase, ServiceProviderBase, ParentUser, AdminUser).
export * from '@ejm/shared-core';

/** Babysitter-specific user fields */
export interface BabysitterUser extends ServiceProviderBase {
  role: 'babysitter';

  // Babysitting preferences
  kidAgeRange: { min: number; max: number };
  maxKids: number;
  hourlyRate: number;

  // Contact sharing consent (babysitter-specific)
  contactSharingConsent?: boolean;
  approvedFamilies?: string[];
}

/** Union type for any user document in sync-sit */
export type UserDoc = BabysitterUser | ParentUser | AdminUser;

/**
 * Lightweight babysitter info used in family-facing UI (search results,
 * favorites, dashboard cards). A subset of BabysitterUser with a few
 * computed fields (age, distance, name).
 */
export interface BabysitterSummary {
  uid: string;
  firstName: string;
  lastName: string;
  name?: string;           // pre-formatted display name
  age?: number;            // computed from dateOfBirth
  classLevel?: string;
  languages?: string[];
  photoUrl?: string | null;
  aboutMe?: string | null;
  kidAgeRange?: { min: number; max: number };
  maxKids?: number;
  hourlyRate?: number;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  distance?: number;       // computed from search
  referenceCount?: number; // computed from search
  worksInYourArea?: boolean;
  isPreferred?: boolean;
}
