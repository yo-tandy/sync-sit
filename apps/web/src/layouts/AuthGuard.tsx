import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { Spinner } from '@/components/ui';
import type { UserRole } from '@ejm/shared';

interface AuthGuardProps {
  role: UserRole;
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

  if (userDoc.role !== role) {
    // Redirect to correct portal
    if (userDoc.role === 'babysitter') return <Navigate to="/babysitter" replace />;
    if (userDoc.role === 'parent') return <Navigate to="/family" replace />;
    if (userDoc.role === 'admin') return <Navigate to="/admin" replace />;
    return <Navigate to="/" replace />;
  }

  // Redirect babysitters with incomplete enrollment to enrollment flow
  if (userDoc.role === 'babysitter' && (userDoc as any).enrollmentComplete === false) {
    return <Navigate to="/enroll/babysitter" replace />;
  }

  return <>{children}</>;
}
