/**
 * Post-sign-in landing per sit role. Shared by the login page and the
 * cross-app handoff page so both entrances land users identically.
 */
export function postLoginRouter(role: string | undefined): string {
  if (role === 'babysitter') return '/babysitter';
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  // Foreign-profile-only users (no sit role) go to /signup to add a sit role,
  // rather than dead-ending at '/'.
  return '/signup';
}
