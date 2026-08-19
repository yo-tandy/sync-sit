import { isBabysitter, hasAnyContact } from '@ejm/shared-core';
import type { StudyUser } from '@ejm/study-core';

/**
 * Can this sit babysitter take the one-tap crossApp path? enrollTutor's
 * crossApp mode derives classLevel + a contact field + root identity from
 * the babysitter profile — sit guarantees NONE of them (contact is
 * skippable, abandoned signups lack classLevel and identity). Users missing
 * any prerequisite go to the CLASSIC /enroll/tutor wizard, which collects
 * exactly the missing pieces (and, via identity-on-file, only those).
 * Contact resolves through the canonical root ?? nested fallback (issue
 * #203 shared identity), matching what the crossApp callable copies.
 */
export function canCrossAppEnrollTutor(userDoc: StudyUser | null | undefined): boolean {
  if (!userDoc) return false;
  const bs = (userDoc as unknown as { profiles?: { babysitter?: Record<string, unknown> } })
    .profiles?.babysitter;
  if (!bs) return false;
  const hasIdentity = !!userDoc.firstName && !!userDoc.lastName && !!userDoc.dateOfBirth;
  const hasClassLevel = !!bs.classLevel;
  return hasIdentity && hasClassLevel && hasAnyContact(userDoc);
}

/**
 * Post-sign-in landing per study role. Shared by the login page and the
 * cross-app handoff page so both entrances land users identically.
 */
export function postLoginRouter(role: string | undefined, userDoc?: StudyUser | null): string {
  if (role === 'tutor') return '/tutor';
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  // A sit babysitter with no study role never sees the role question (issue
  // #144, owner call): tutoring is study's only offer for an EJM student, so
  // the welcome page states it and enrolls with subjects alone — WHEN the
  // sit profile carries everything crossApp derives. Otherwise the classic
  // wizard collects the missing pieces.
  if (userDoc && isBabysitter(userDoc)) {
    return canCrossAppEnrollTutor(userDoc) ? '/welcome-study' : '/enroll/tutor';
  }
  // Foreign-profile-only users (no study role) go to /signup, not dead-end '/'.
  return '/signup';
}
