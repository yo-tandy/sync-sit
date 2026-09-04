import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { getDoRole, type DoRole } from '@/utils/doRole';

interface AuthGuardProps {
  /** Portal role this route belongs to. Since PR8 every authenticated
   * route is role-guarded: 'parent' for the family portal, 'doer' for the
   * doer portal (whose /doer/board replaced the PR2 placeholder shell). */
  role: DoRole;
  children: React.ReactNode;
}

/**
 * Route guard for do-web, following study-web's AuthGuard pattern
 * (loading -> render nothing; signed-out -> /login; role mismatch -> that
 * role's own portal).
 *
 * Like study, the guard does NOT gate on enrollment completeness or family
 * verification — those are the surfaces' own banners/errors, never the
 * guard's (the callables are the real gates).
 *
 * ADMIN accounts pass the DOER guard. do-web has no admin tree (plan §9.4
 * — admin lives only in apps/web), so an admin needs SOME landing here,
 * and the doer portal is the one whose reads work for them: §7.2's
 * `isAdmin()` disjuncts make `doTasks`/`taskOffers` admin-readable
 * (caller-based, so the board query stays provable), and the uid-scoped
 * lists simply come back empty. Bouncing admins off /doer instead would
 * loop the guard against its own mismatch fallback.
 */
export function AuthGuard({ role, children }: AuthGuardProps) {
  const { firebaseUser, userDoc, loading } = useAuthStore();

  // Auth state still resolving: render nothing rather than flashing a
  // redirect before we know who the visitor is. The blank frame sits on the
  // portal's tinted ground, not white (#424): the mounting layout has already
  // stamped its ground on <html> via useDocumentGround before this renders.
  if (loading) return null;

  // Not signed in at all -> the login page.
  if (!firebaseUser) return <Navigate to="/login" replace />;

  const doRole = getDoRole(userDoc);
  if (doRole !== role && !(role === 'doer' && doRole === 'admin')) {
    // Role-mismatch fallback mirrors postLoginRouter so the guard and the
    // post-login router agree: parents to /family; doers (and admins, per
    // the pass-through above) to the doer portal. An account with no
    // sync-do role falls through to /signup to add one rather than
    // dead-ending.
    if (doRole === 'parent') return <Navigate to="/family" replace />;
    if (doRole === 'doer' || doRole === 'admin') return <Navigate to="/doer" replace />;
    return <Navigate to="/signup" replace />;
  }

  return <>{children}</>;
}
