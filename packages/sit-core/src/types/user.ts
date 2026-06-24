// Re-export the generic user types so consumers importing from '@ejm/sit-core'
// see the full surface (User, SitUser, BabysitterProfile, ParentProfile, …).
export * from '@ejm/shared-core';

/**
 * Lightweight babysitter info used in family-facing UI (search results,
 * favorites, dashboard cards) — a subset of the babysitter profile plus a few
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
