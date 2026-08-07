/**
 * Post-sign-in landing per study role. Shared by the login page and the
 * cross-app handoff page so both entrances land users identically.
 */
export function postLoginRouter(role: string | undefined): string {
  if (role === 'tutor') return '/tutor';
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  // Foreign-profile-only users (no study role) go to /signup, not dead-end '/'.
  return '/signup';
}
