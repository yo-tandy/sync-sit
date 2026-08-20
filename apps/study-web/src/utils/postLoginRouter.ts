import { isBabysitter, hasAnyContact, getEjemEmail } from '@ejm/shared-core';
import type { StudyUser } from '@ejm/study-core';

function babysitterProfileOf(
  userDoc: StudyUser | null | undefined,
): Record<string, unknown> | undefined {
  return (userDoc as unknown as { profiles?: { babysitter?: Record<string, unknown> } } | null)
    ?.profiles?.babysitter;
}

/**
 * Can this sit babysitter take the crossApp path? The only hard prerequisite
 * is the verified EJM identity on the babysitter profile — enrollTutor's
 * crossApp mode derives the EJM email from it and copies classLevel/gender/
 * contact when present; whatever the sit profile lacks (contact is skippable
 * in sit, pre-age-gate docs miss a DOB, abandoned signups miss classLevel),
 * /welcome-study collects as a supplement (issue #203). The classic
 * /enroll/tutor wizard — school re-verification included — is only for users
 * with no verified babysitter identity at all.
 */
export function canCrossAppEnrollTutor(userDoc: StudyUser | null | undefined): boolean {
  const bs = babysitterProfileOf(userDoc);
  if (!bs) return false;
  // The EJM identity is canonical at the ROOT with a nested fallback (issue
  // #203 shared identity) — mirror the server: a babysitter profile must
  // exist (that is what proves a real enrollment verified the email), and
  // the email may live at either level.
  const ejem = getEjemEmail(userDoc as never);
  return typeof ejem === 'string' && ejem.length > 0;
}

/** Which crossApp-derivable fields the sit doc does NOT carry — exactly the
 * inputs /welcome-study must render alongside subjects (issue #203). */
export interface CrossAppTutorGaps {
  firstName: boolean;
  lastName: boolean;
  dateOfBirth: boolean;
  classLevel: boolean;
  gender: boolean;
  /** True when none of contactEmail/contactPhone/whatsapp is set. */
  contact: boolean;
}

export function crossAppTutorGaps(userDoc: StudyUser | null | undefined): CrossAppTutorGaps {
  const doc = (userDoc ?? {}) as unknown as Record<string, unknown>;
  const bs = babysitterProfileOf(userDoc) ?? {};
  return {
    firstName: !doc.firstName,
    lastName: !doc.lastName,
    dateOfBirth: !doc.dateOfBirth,
    classLevel: !bs.classLevel,
    // Sit's profile step saves `gender || null`: null means the question was
    // ANSWERED with "no answer" — only a truly absent field (the step never
    // ran) is asked again.
    gender: bs.gender === undefined,
    // Root ?? nested resolution (shared identity): a root-only contact edit
    // counts, matching what the crossApp callable copies.
    contact: !hasAnyContact(userDoc as never),
  };
}

export function hasCrossAppTutorGaps(gaps: CrossAppTutorGaps): boolean {
  return (
    gaps.firstName ||
    gaps.lastName ||
    gaps.dateOfBirth ||
    gaps.classLevel ||
    gaps.gender ||
    gaps.contact
  );
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
  // the welcome page states it and enrolls with subjects plus whatever the
  // sit profile is missing (issue #203) — never re-verifying the school
  // email. Only a doc with no verified babysitter identity falls back to the
  // classic wizard.
  if (userDoc && isBabysitter(userDoc)) {
    return canCrossAppEnrollTutor(userDoc) ? '/welcome-study' : '/enroll/tutor';
  }
  // Foreign-profile-only users (no study role) go to /signup, not dead-end '/'.
  return '/signup';
}
