import type { FirestoreTimestamp, LatLng, NotifPrefs } from './common.js';
import type { UserRole, AccountStatus, AreaMode, Language } from '../constants/index.js';

/** Base user fields shared by all roles */
export interface UserBase {
  uid: string;
  role: UserRole;
  email: string;
  status: AccountStatus;
  firstName: string;
  lastName: string;
  language: Language;
  notifPrefs: NotifPrefs;
  fcmTokens: string[];
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  lastLoginAt?: FirestoreTimestamp;
  consentAt?: FirestoreTimestamp;
  consentVersion?: string;

  /** True once the user has dismissed the "Add to Home Screen" banner. */
  dismissedPwaInstallBanner?: boolean;
}

/** Babysitter-specific user fields */
export interface BabysitterUser extends UserBase {
  role: 'babysitter';
  ejemEmail: string;
  dateOfBirth: FirestoreTimestamp;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  classLevel: string;
  photoUrl?: string;
  languages: string[];
  aboutMe?: string;

  // Babysitting preferences
  kidAgeRange: { min: number; max: number };
  maxKids: number;
  hourlyRate: number;

  // Contact (at least one required)
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;

  // Contact sharing consent
  contactSharingConsent?: boolean;
  approvedFamilies?: string[];

  // Area
  areaMode: AreaMode;
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: LatLng;
  areaRadiusKm?: number;

  // Enrollment state (false = incomplete, undefined/true = complete)
  enrollmentComplete?: boolean;

  // Search visibility (default false — must be activated by babysitter)
  searchable?: boolean;

  // Revalidation
  lastRevalidatedAt?: FirestoreTimestamp;
  revalidationYear?: number;
}

/** Parent-specific user fields */
export interface ParentUser extends UserBase {
  role: 'parent';
  familyId: string;
}

/** Admin user fields */
export interface AdminUser extends UserBase {
  role: 'admin';
}

/** Union type for any user document */
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
