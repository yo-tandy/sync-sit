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
  // Any server-verified EJM identity with no role IN THIS APP gets offered
  // the crossApp continuation (issue #435 milestone, PR4) — not just a
  // unified-flow user who abandoned /enroll/student mid-way. Decision 20
  // forbids sit/study reachability INTO do, not the reverse: a sync-do doer
  // has a verified root ejemEmail (enrollDoer writes it the same way
  // enrollStudentIdentity does) and no sit role, so they are as entitled to
  // add babysitting as any other verified student — this is the concrete,
  // common case this branch serves, alongside the abandoned-unified-flow
  // one; enrollBabysitter's/enrollTutor's crossApp preconditions already
  // allow this server-side (see that PR's fix). Checked via the resolved
  // root ejemEmail (present only once a code-verified enrollment wrote it)
  // — a doc with NO verified identity at all (no profiles, no ejemEmail) is
  // a genuinely fresh visitor and still belongs on /signup.
  if (userDoc && !userDoc.profiles?.babysitter && !userDoc.profiles?.parent && getEjemEmail(userDoc)) {
    return '/enroll/choose-app';
  }
  // Foreign-profile-only users (no sit role) go to /signup to add a sit role,
  // rather than dead-ending at '/'.
  return '/signup';
}
