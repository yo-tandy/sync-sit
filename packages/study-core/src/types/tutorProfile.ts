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
  /**
   * Back-compat duplicate only (issue #435 milestone, PR1): canonical at
   * root `User.classLevel` now. enrollTutor no longer writes this for new
   * profiles — readers use getClassLevel (root ?? babysitter ?? tutor),
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
  /**
   * Cancellation-notice policy in hours (one of CANCELLATION_NOTICE_PRESETS;
   * absent → 0 = no policy). Tutor-editable directly (like paddingMin) and
   * deliberately NOT rules-pinned: enforcement reads the snapshot taken onto
   * each session at request time, never this live value.
   */
  cancellationNoticeHours?: number;

  // Search visibility
  searchable?: boolean;

  /**
   * Server-owned, denormalized result of `computeEffectiveSearchable`
   * (issue #435 PR2 — shared-core), folding in `status === 'active'`,
   * `searchable`, and `enrollmentComplete`. Written ONLY by the
   * `onUserWrittenRecomputeSearchable` Firestore trigger (apps/functions,
   * covers both provider profiles from one codebase — see the guardian
   * mirror trigger precedent) — never by a client or a callable directly —
   * whenever any of its three inputs changes. `searchTutors` filters on THIS
   * field instead of re-deriving the same boolean (and its separate
   * `enrollmentComplete`/`searchable` query clauses) at every query. Absent
   * on a doc the trigger/backfill has not yet touched — treated as not
   * searchable, never as a fallback to the raw `searchable` toggle.
   */
  effectiveSearchable?: boolean;

  /**
   * Stable personal code for direct lookup (issue #235, parity A2): 8
   * uppercase hex chars a tutor hands to families they already know, resolved
   * by the lookupTutor callable. Server-owned: minted ONLY by
   * getTutorPersonalCode (mint-on-first-read) and pinned immutable against
   * owner writes by security rules — a client choosing its own code could
   * squat a memorable one or collide with another tutor's. Resolving the code
   * additionally requires `searchable === true` AT LOOKUP TIME (the gate
   * lives in lookupTutor, not here), so the code goes dormant with the
   * visibility toggle rather than bypassing it.
   */
  personalCode?: string;

  /**
   * When this tutor last visited the published-searches board (issue #207).
   * Owner-written from the client on section visit (deliberately not
   * rules-pinned — it only drives the owner's own "New" tagging/badge):
   * a board doc is New iff createdAt > this. Absent = never visited.
   */
  publishedSearchesSeenAt?: FirestoreTimestamp;

  /**
   * Server-owned denormalized count of the tutor's approved/published study
   * endorsements. Written only by respondToTutorEndorsement (accept path,
   * FieldValue.increment) and pinned immutable against owner writes by security
   * rules (a client must not inflate it). searchTutors reads this instead of
   * scanning the references collection per call. Absent → treated as 0.
   */
  endorsementCount?: number;

  /**
   * Family IDs the tutor has approved for contact-field sharing. Server-owned:
   * written only by the respondToTutorContactRequest callable (accept path,
   * via arrayUnion) and pinned immutable against owner writes by security
   * rules. Contact fields are projected in search results only for callers
   * whose familyId appears here.
   */
  approvedFamilies?: string[];

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
