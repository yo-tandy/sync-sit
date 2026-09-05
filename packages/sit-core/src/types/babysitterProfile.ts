import type { FirestoreTimestamp, LatLng, ProfileBase, ParentProfile, User, AreaMode } from '@ejm/shared-core';

/**
 * Sync-sit babysitter profile. Lives at users/{uid}.profiles.babysitter
 * in the Plan D portable-user schema.
 */
export interface BabysitterProfile extends ProfileBase {
  // Identity (EJM-side)
  ejemEmail: string;
  /**
   * Back-compat duplicate only (issue #435 milestone, PR1): canonical at
   * root `User.classLevel` now. enrollBabysitter no longer writes this for
   * new profiles — readers use getClassLevel (root ?? babysitter ?? tutor),
   * never this field directly. Optional because a post-promotion profile
   * genuinely lacks it; pre-existing docs keep their value until backfilled.
   */
  classLevel?: string;
  /** Back-compat duplicate only (issue #435 milestone, PR1): canonical at
   *  root `User.gender` now — see the classLevel note above. */
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
  // Notice window (hours) families are asked to respect when cancelling; 0 =
  // no policy. Snapshotted onto each appointment at creation (issue #237,
  // study's V2 feature 7 ported to sit).
  cancellationNoticeHours?: number;
  contactSharingConsent?: boolean;
  approvedFamilies?: string[];

  // Search visibility
  searchable?: boolean;

  /**
   * Server-owned, denormalized result of `computeEffectiveSearchable`
   * (issue #435 PR2 — shared-core), folding in `status === 'active'`,
   * `searchable`, and `enrollmentComplete`. Written ONLY by the
   * `onUserWrittenRecomputeSearchable` Firestore trigger (apps/functions) —
   * never by a client or a callable directly — whenever any of its three
   * inputs changes. `searchBabysitters`/`lookupBabysitter` filter on THIS
   * field instead of re-deriving the same boolean at every query. Absent on
   * a doc the trigger/backfill has not yet touched — treated as not
   * searchable (a missing field never equals `true` in a Firestore
   * equality query), never as a fallback to the raw `searchable` toggle.
   */
  effectiveSearchable?: boolean;

  /**
   * When this babysitter last visited the published-searches board (issue
   * #207). Owner-written from the client on section visit (deliberately not
   * rules-pinned — it only drives the owner's own "New" tagging/badge):
   * a board doc is New iff createdAt > this. Absent = never visited.
   */
  publishedSearchesSeenAt?: FirestoreTimestamp;

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
