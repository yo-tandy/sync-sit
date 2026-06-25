import type { User } from '@ejm/shared-core';
import { getParentProfile, isAdmin } from '@ejm/shared-core';
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
export type TutorView = User & TutorProfile;

export function getTutorView(
  user: User | null | undefined,
): TutorView | null {
  const profile = getTutorProfile(user);
  if (!user || !profile) return null;
  return { ...user, ...profile };
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
