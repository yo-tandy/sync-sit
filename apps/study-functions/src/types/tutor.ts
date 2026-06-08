import type { ServiceProviderBase } from '@ejm/shared-core';
import type { SubjectOffering, LocationPref } from './subject.js';

/**
 * Tutor-specific user document.
 * Extends ServiceProviderBase (which already carries: uid, ejemEmail,
 * dateOfBirth, classLevel, gender, photoUrl, languages, aboutMe,
 * contactEmail, contactPhone, whatsapp, areaMode, arrondissements,
 * areaAddress, areaLatLng, areaRadiusKm, enrollmentComplete, searchable,
 * lastRevalidatedAt, revalidationYear).
 *
 * `role` is omitted from ServiceProviderBase (which constrains it to the
 * existing UserRole union) and re-narrowed to the literal 'tutor'. This
 * avoids a TS2430 error while staying structurally compatible. When the
 * roles constant is extended to include 'tutor' in shared-core, this Omit
 * can be removed.
 */
export interface TutorUser extends Omit<ServiceProviderBase, 'role'> {
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
