import type { User } from '@ejm/shared-core';
import { getParentProfile, isAdmin, getClassLevel, getGender } from '@ejm/shared-core';
import type { TutorProfile } from './tutorProfile.js';

// User-doc accessors for sync-study (Plan D). The tutor profile lives at
// users/{uid}.profiles.tutor.

export function getTutorProfile(
  user: User | null | undefined,
): TutorProfile | undefined {
  return user?.profiles?.tutor as TutorProfile | undefined;
}

/**
 * Flattened tutor record: User base fields merged with the tutor profile.
 */
// The root shared-identity quartet (ejemEmail + contact trio, issue #203) is
// omitted from the User half: the PROFILE copy wins in the flattened view
// (pre-change behavior). Code that wants the canonical resolution uses
// getEjemEmail/getContact from shared-core instead of the view.
export type TutorView =
  Omit<User, 'ejemEmail' | 'contactEmail' | 'contactPhone' | 'whatsapp'> & TutorProfile;

export function getTutorView(
  user: User | null | undefined,
): TutorView | null {
  const profile = getTutorProfile(user);
  if (!user || !profile) return null;
  const { ejemEmail: _ee, contactEmail: _ce, contactPhone: _cp, whatsapp: _wa, ...base } = user;
  return {
    ...base,
    ...profile,
    // classLevel/gender promoted to root (issue #435 milestone, PR1) —
    // unlike ejemEmail/contact above, the view DOES resolve these root-first
    // (getClassLevel/getGender: root ?? babysitter ?? tutor) so existing
    // display call sites reading `view.classLevel`/`view.gender` keep working
    // for un-backfilled and legacy docs without switching to the resolvers
    // individually.
    classLevel: getClassLevel(user),
    gender: getGender(user),
  };
}

/** The user's role within sync-study, for routing and guards. */
export function getStudyRole(
  user: User | null | undefined,
): 'tutor' | 'parent' | 'admin' | undefined {
  if (!user) return undefined;
  if (getTutorProfile(user)) return 'tutor';
  if (getParentProfile(user)) return 'parent';
  if (isAdmin(user)) return 'admin';
  return undefined;
}
