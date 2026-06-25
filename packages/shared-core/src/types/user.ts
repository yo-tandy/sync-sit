import type { FirestoreTimestamp, NotifPrefs } from './common.js';
import type { AccountStatus, Language } from '../constants/index.js';

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

