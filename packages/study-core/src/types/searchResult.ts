import type { LocationPref, SubjectOffering } from './subject.js';
import type { StudyContactRequestStatus } from './contactRequest.js';

/**
 * A single tutor row returned by the searchTutors callable. Projects a subset
 * of the tutor's profile plus search-derived fields (matched subject/level and
 * rate, distance, endorsement count, this family's request status). Contact
 * fields are present ONLY when the caller's family is in the tutor's
 * approvedFamilies.
 */
export interface TutorSearchResult {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  languages: string[];
  aboutMe?: string;
  classLevel: string;

  /** The searched subject this tutor matched on. */
  subject: string;
  /** The searched class level this tutor matched on. */
  level: string;
  /** Hourly rate for the MATCHED subject (not a global rate). */
  rate: number;
  /** Class levels the tutor covers for the matched subject. */
  levels: string[];
  sessionLengthsMin: number[];
  locationPrefs: LocationPref[];

  /** Haversine distance in km, or null when it cannot be computed. */
  distance: number | null;
  /** Count of the tutor's approved/published endorsements. */
  endorsementCount: number;
  /** Tutor's cancellation-notice policy in hours (0 = no policy). */
  cancellationNoticeHours: number;
  /**
   * This family's contact-request status toward the tutor. `'incoming'` is a
   * TUTOR-initiated pending request (issue #207 PR4): the family did not send
   * it, so the card must not read "request sent" — but it must not read
   * "none" either, or the send CTA it offers is rejected as already-exists.
   */
  requestStatus: 'none' | 'incoming' | StudyContactRequestStatus;

  // Contact fields — projected only when the caller's family is approved.
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
}

/**
 * The tutor card returned by the lookupTutor callable (issue #235, parity
 * A2). Same projection discipline as TutorSearchResult — contact fields only
 * for an approved family, locationPrefs already coverage-projected — but
 * with the FULL `subjects` offerings instead of one matched subject/level:
 * the family arrived via a personal code, not a subject query, so the client
 * picks the offering before minting the normal contact request.
 */
export interface TutorLookupResult {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  languages: string[];
  aboutMe?: string;
  classLevel: string;

  /** Every subject the tutor offers, with per-subject rates and levels. */
  subjects: SubjectOffering[];
  sessionLengthsMin: number[];
  locationPrefs: LocationPref[];

  /** Haversine distance in km from the family's saved address, or null. */
  distance: number | null;
  endorsementCount: number;
  cancellationNoticeHours: number;
  /** Same semantics as TutorSearchResult.requestStatus. */
  requestStatus: 'none' | 'incoming' | StudyContactRequestStatus;

  // Contact fields — projected only when the caller's family is approved.
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
}
