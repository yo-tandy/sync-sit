import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { Spinner } from '@/components/ui';
import { getSitRole, getBabysitterProfile } from '@ejm/sit-core';

type SitRole = 'babysitter' | 'parent' | 'admin';

interface AuthGuardProps {
  role: SitRole;
  children: React.ReactNode;
}

export function AuthGuard({ role, children }: AuthGuardProps) {
  const { firebaseUser, userDoc, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-red-600" />
      </div>
    );
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  if (!userDoc) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-red-600" />
      </div>
    );
  }

  const sitRole = getSitRole(userDoc);

  if (sitRole !== role) {
    // Redirect to correct portal
    if (sitRole === 'babysitter') return <Navigate to="/babysitter" replace />;
    if (sitRole === 'parent') return <Navigate to="/family" replace />;
    if (sitRole === 'admin') return <Navigate to="/admin" replace />;
    return <Navigate to="/" replace />;
  }

  // Redirect babysitters with incomplete enrollment to enrollment flow
  if (sitRole === 'babysitter' && getBabysitterProfile(userDoc)?.enrollmentComplete === false) {
    return <Navigate to="/enroll/babysitter" replace />;
  }

  return <>{children}</>;
}
