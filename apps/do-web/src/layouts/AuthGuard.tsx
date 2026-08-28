import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Route guard for the authenticated shell, following study-web's AuthGuard
 * pattern (loading -> render nothing; signed-out -> /login). One DELIBERATE
 * shell-stage divergence: there is no role check yet. sync-do's roles
 * (doer / parent / admin) get portals in plan §13 PR4/PR7/PR8, and the
 * guard grows the role prop and mismatch routing when those exist — the
 * shell's single placeholder home is open to any signed-in account.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { firebaseUser, loading } = useAuthStore();

  // Auth state still resolving: render nothing rather than flashing a
  // redirect before we know who the visitor is.
  if (loading) return null;

  // Not signed in at all -> the login page.
  if (!firebaseUser) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
