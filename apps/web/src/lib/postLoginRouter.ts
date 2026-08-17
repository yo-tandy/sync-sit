import { isTutor } from '@ejm/shared-core';
import type { SitUser } from '@ejm/sit-core';

/**
 * Post-sign-in landing per sit role. Shared by the login page and the
 * cross-app handoff page so both entrances land users identically.
 */
export function postLoginRouter(role: string | undefined, userDoc?: SitUser | null): string {
  if (role === 'babysitter') return '/babysitter';
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  // A study tutor with no sit role never sees the role question (issue #144,
  // owner call): babysitting is sit's only offer for an EJM student, so the
  // welcome page states it and enrolls in one tap.
  if (userDoc && isTutor(userDoc)) return '/welcome-sit';
  // Foreign-profile-only users (no sit role) go to /signup to add a sit role,
  // rather than dead-ending at '/'.
  return '/signup';
}
