import { Navigate, useLocation } from 'react-router';

/**
 * `/signup` (issue #435 milestone, PR5): the old sit-only role question is
 * retired in favor of `/enroll`, the new unified cross-app landing page
 * (`EnrollLandingPage`). This route STAYS MOUNTED — external links and
 * bookmarks to `/signup` must keep resolving rather than 404ing — but its
 * only job now is to forward to `/enroll`, preserving whatever query string
 * arrived with it (e.g. a bookmarked `?lang=fr`).
 *
 * In-app entry points (the login page's "create an account" link, the
 * welcome page's "Sign up" CTA) were repointed straight at `/enroll` in this
 * same PR, so a fresh in-app click never actually takes this extra hop —
 * this component only fires for the routes this PR could not rewrite: old
 * bookmarks, stale marketing links, and anything else still typing
 * `/signup` directly into the address bar.
 */
export function SignUpRedirectPage() {
  const { search } = useLocation();
  return <Navigate to={`/enroll${search}`} replace />;
}
