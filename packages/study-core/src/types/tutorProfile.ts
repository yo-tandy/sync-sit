import type {
  FirestoreTimestamp,
  LatLng,
  ProfileBase,
  ParentProfile,
  User,
  AreaMode,
} from '@ejm/shared-core';
import type { SubjectOffering, LocationPref } from './subject.js';

/**
 * Sync-study tutor profile. Lives at users/{uid}.profiles.tutor in the
 * Plan D portable-user schema. Mirrors BabysitterProfile's shared fields
 * (EJM identity, contact, area, search, revalidation) plus tutor-specific
 * session preferences.
 */
export interface TutorProfile extends ProfileBase {
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

  // Tutor-specific session preferences
  /** Subjects the tutor offers with per-subject rates and covered levels. */
  subjects: SubjectOffering[];
  /** Session lengths (in minutes) the tutor offers, e.g. [45, 60]. */
  sessionLengthsMin: number[];
  /** Location types the tutor accepts for sessions. */
  locationPrefs: LocationPref[];
  /**
   * Transit padding (minutes) required before/after each in-person session
   * (applies when location is family_home or tutor_home).
   */
  paddingMin: number;

  // Search visibility
  searchable?: boolean;

  // Revalidation
  lastRevalidatedAt?: FirestoreTimestamp;
  revalidationYear?: number;
}

/**
 * Narrowed User for sync-study. Only the tutor + parent profile slots are
 * typed here; the underlying doc may also carry a babysitter profile but
 * it's opaque from sync-study's perspective.
 */
export interface StudyUser extends User {
  profiles: {
    tutor?: TutorProfile;
    parent?: ParentProfile;
  };
}
