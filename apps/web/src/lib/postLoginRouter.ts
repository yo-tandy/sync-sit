import { isTutor, getEjemEmail } from '@ejm/shared-core';
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
  // Root-only unified-flow identity (issue #435 milestone, PR4): the user
  // created their account through /enroll/student and got EJM-verified, but
  // never finished picking sit or study (closed the tab, lost connectivity,
  // etc.). Send them back to the choice screen instead of dead-ending at
  // /signup, which would ask the role question again and, on the babysitter
  // path, walk them through the classic wizard's OWN identity steps for
  // information already on file. Checked via the resolved root ejemEmail
  // (present only once a code-verified enrollment wrote it) — a doc with no
  // profiles AND no verified identity is a genuinely fresh visitor and still
  // belongs on /signup.
  if (userDoc && !userDoc.profiles?.babysitter && !userDoc.profiles?.parent && getEjemEmail(userDoc)) {
    return '/enroll/choose-app';
  }
  // Foreign-profile-only users (no sit role) go to /signup to add a sit role,
  // rather than dead-ending at '/'.
  return '/signup';
}
