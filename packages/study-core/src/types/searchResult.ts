import type { LocationPref } from './subject.js';
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
  /** This family's contact-request status toward the tutor. */
  requestStatus: 'none' | StudyContactRequestStatus;

  // Contact fields — projected only when the caller's family is approved.
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
}
