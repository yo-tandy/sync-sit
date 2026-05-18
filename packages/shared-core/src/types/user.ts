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

/**
 * Fields common to any service provider (babysitter, tutor, ...).
 * Apps extend this with role-specific fields (e.g. BabysitterUser in sync-sit,
 * TutorUser in sync-study). `role` is inherited from UserBase as `UserRole`;
 * subtypes narrow it to a literal (e.g. `'babysitter'` or `'tutor'`).
 */
export interface ServiceProviderBase extends UserBase {
  ejemEmail: string;
  dateOfBirth: FirestoreTimestamp;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  classLevel: string;
  photoUrl?: string;
  languages: string[];
  aboutMe?: string;

  // Contact (at least one required)
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;

  // Area
  areaMode: AreaMode;
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: LatLng;
  areaRadiusKm?: number;

  // Enrollment state
  enrollmentComplete?: boolean;

  // Search visibility (default false - must be activated by the provider)
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
