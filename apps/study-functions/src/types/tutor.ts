import type { ServiceProviderBase } from '@ejm/shared-core';
import type { SubjectOffering, LocationPref } from './subject.js';

/**
 * Tutor-specific user document.
 * Extends ServiceProviderBase (which already carries: uid, ejemEmail,
 * dateOfBirth, classLevel, gender, photoUrl, languages, aboutMe,
 * contactEmail, contactPhone, whatsapp, areaMode, arrondissements,
 * areaAddress, areaLatLng, areaRadiusKm, enrollmentComplete, searchable,
 * lastRevalidatedAt, revalidationYear).
 */
export interface TutorUser extends ServiceProviderBase {
  role: 'tutor';

  /** Subjects the tutor offers with per-subject rates and covered levels. */
  subjects: SubjectOffering[];

  /**
   * Session lengths (in minutes) the tutor is willing to offer.
   * Subset of SESSION_LENGTHS, e.g. [45, 60].
   */
  sessionLengthsMin: number[];

  /** Location types the tutor accepts for sessions. */
  locationPrefs: LocationPref[];

  /**
   * Transit padding the tutor requires before and after each in-person
   * session (applies when location is family_home or tutor_home).
   * Stored in minutes.
   */
  paddingMin: number;

  /** Enrollment completion tracking per app. */
  profiles?: {
    study: {
      enrollmentComplete: boolean;
    };
  };
}
