import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { getDoRole, type DoRole } from '@/utils/doRole';

interface AuthGuardProps {
  /**
   * Portal role this route belongs to. Omitted = the roleless shell (the
   * placeholder /home): any signed-in account passes — that page is the
   * doer's landing until the doer portal ships (plan §13 PR8), and the
   * neutral landing for accounts with no sync-do role yet.
   */
  role?: DoRole;
  children: React.ReactNode;
}

/**
 * Route guard for do-web, following study-web's AuthGuard pattern
 * (loading -> render nothing; signed-out -> /login; role mismatch -> that
 * role's own portal). The family portal (plan §13 PR7) is the first
 * role-guarded surface; the doer portal grows its own role at PR8.
 *
 * Like study, the guard does NOT gate on enrollment completeness or family
 * verification — those are the surfaces' own banners/errors, never the
 * guard's (the doPostTask callable is the real gate for posting).
 */
export function AuthGuard({ role, children }: AuthGuardProps) {
  const { firebaseUser, userDoc, loading } = useAuthStore();

  // Auth state still resolving: render nothing rather than flashing a
  // redirect before we know who the visitor is.
  if (loading) return null;

  // Not signed in at all -> the login page.
  if (!firebaseUser) return <Navigate to="/login" replace />;

  // Roleless shell route: any signed-in account.
  if (!role) return <>{children}</>;

  const doRole = getDoRole(userDoc);
  if (doRole !== role) {
    // Role-mismatch fallback mirrors postLoginRouter so the guard and the
    // post-login router agree: parents to /family; doers (and admins, whose
    // panel lives only in apps/web — plan §9.4) to the shell home. An
    // account with no sync-do role falls through to /signup to add one
    // rather than dead-ending.
    if (doRole === 'parent') return <Navigate to="/family" replace />;
    if (doRole === 'doer' || doRole === 'admin') return <Navigate to="/home" replace />;
    return <Navigate to="/signup" replace />;
  }

  return <>{children}</>;
}
