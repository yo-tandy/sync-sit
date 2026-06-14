import type { FirestoreTimestamp, LatLng, NotifPrefs } from './common.js';
import type { UserRole, AccountStatus, AreaMode, Language } from '../constants/index.js';

// ---------------------------------------------------------------------------
// New schema (Plan D — portable user entity)
// ---------------------------------------------------------------------------
//
// Generic User entity that supports a single person being both a babysitter
// (sync-sit side) and a tutor (sync-study side), or any combination of roles.
// Each app's concrete profile shape lives in its respective package:
// BabysitterProfile in @ejm/sit-core, TutorProfile in @ejm/study-core.
// ParentProfile is shared across both apps (one familyId per person).

export interface User {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  status: AccountStatus;
  dateOfBirth?: FirestoreTimestamp;
  photoUrl?: string;
  language: Language;
  notifPrefs: NotifPrefs;
  fcmTokens: string[];
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  lastLoginAt?: FirestoreTimestamp;
  consentAt?: FirestoreTimestamp;
  consentVersion?: string;
  dismissedPwaInstallBanner?: boolean;

  profiles: {
    babysitter?: ProfileBase;
    tutor?: ProfileBase;
    parent?: ParentProfile;
  };

  isAdmin?: boolean;
}

export interface ProfileBase {
  enrollmentComplete: boolean;
}

export interface ParentProfile extends ProfileBase {
  familyId: string;
  /** Parent contact (optional — collected during family enrollment). */
  phone?: string;
  whatsapp?: string;
}

// ---------------------------------------------------------------------------
// Legacy schema (pre-Plan D)
// ---------------------------------------------------------------------------
//
// Kept exported during the transition so consumers can migrate one
// reader at a time. After Tier E lands and prod is migrated, a follow-up
// PR deletes everything below.

/** @deprecated Use {@link User} (Plan D). Removed after prod migration. */
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

/** @deprecated Use {@link User} + per-app profile types (Plan D). */
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

/** @deprecated Use {@link User} with `profiles.parent` (Plan D). */
export interface ParentUser extends UserBase {
  role: 'parent';
  familyId: string;
}

/** @deprecated Use {@link User} with `isAdmin: true` (Plan D). */
export interface AdminUser extends UserBase {
  role: 'admin';
}
