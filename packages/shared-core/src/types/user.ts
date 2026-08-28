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
  /** Sit push registrations. The legacy flat array predates study push and
   * stays sit's; study registrations live in the sibling `fcmTokensStudy`. */
  fcmTokens: string[];
  fcmTokensStudy?: string[];
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  lastLoginAt?: FirestoreTimestamp;
  consentAt?: FirestoreTimestamp;
  consentVersion?: string;
  dismissedPwaInstallBanner?: boolean;
  dismissedPwaInstallBannerStudy?: boolean;

  /**
   * Shared identity fields, canonical at the ROOT (owner decisions on issue
   * #203 / PR #205: one account across the sync apps, not per-app copies).
   * The nested profiles.{babysitter,tutor} copies remain as back-compat
   * duplicates written by the server enrollment callables; readers go through
   * getEjemEmail/getContact (root ?? nested fallback) so un-backfilled and
   * legacy docs keep working.
   * - ejemEmail: verified EJM identity; server-owned, rules-pinned
   *   client-immutable (enrollment callables + backfill only).
   * - contact fields: owner-editable, shared across apps; Account pages
   *   write these root fields ONLY.
   */
  ejemEmail?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  whatsapp?: string | null;

  /**
   * Supervision mirror, present iff the guardianLinks/{uid} doc is ACTIVE
   * (a pending claim does NOT set it). Server-owned, rules-pinned.
   */
  governedBy?: { familyId: string; linkedAt: FirestoreTimestamp };
  /**
   * Parent-created accounts only: firstName/lastName/dateOfBirth are
   * parent-attested and immutable client-side (corrections go through the
   * correctChildIdentity callable or admin). Permanent — survives revocation.
   */
  identityLocked?: true;

  /**
   * Cross-app session coherence (issue #181). Server-owned, rules-pinned —
   * bumped ONLY by the signOutEverywhere callable. Both apps capture it at
   * sign-in and watch the user doc; a doc epoch NEWER than the captured one
   * force-signs the local session out. Absent on legacy docs (treated as 0).
   */
  sessionEpoch?: FirestoreTimestamp;

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
  /**
   * Absent = the orphan state removeCoParent leaves behind (membership
   * cleared, profile retained); re-attachable via a fresh invite through
   * addProfileToUser's orphan-parent carve-out (issue #279). Every
   * consumer must guard -- and did already, which is why this was typed
   * required for so long without incident.
   */
  familyId?: string;
  /** Parent contact (optional — collected during family enrollment). */
  phone?: string;
  whatsapp?: string;
}

