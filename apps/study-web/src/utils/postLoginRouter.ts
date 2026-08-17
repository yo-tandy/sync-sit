import { isBabysitter } from '@ejm/shared-core';
import type { StudyUser } from '@ejm/study-core';

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
  // the welcome page states it and enrolls with subjects alone.
  if (userDoc && isBabysitter(userDoc)) return '/welcome-study';
  // Foreign-profile-only users (no study role) go to /signup, not dead-end '/'.
  return '/signup';
}
