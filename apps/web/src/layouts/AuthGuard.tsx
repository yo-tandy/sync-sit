import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { Spinner } from '@/components/ui';
import { getSitRole, getBabysitterProfile } from '@ejm/sit-core';
import { isTutor } from '@ejm/shared-core';

type SitRole = 'babysitter' | 'parent' | 'admin';

interface AuthGuardProps {
  /**
   * The portal this subtree belongs to. OMIT IT for surfaces that belong to
   * no portal -- the shared account hub (#367) is reached by a parent and a
   * student alike, and routing one of them away from it would be wrong. With
   * no role, this guards sign-in only.
   */
  role?: SitRole;
  children: React.ReactNode;
}

export function AuthGuard({ role, children }: AuthGuardProps) {
  const { firebaseUser, userDoc, loading } = useAuthStore();

  // RESOLVE STATES SIT ON THE GROUND WITHOUT A BACKGROUND OF THEIR OWN (#424).
  // The spinner containers below are deliberately transparent: this guard
  // always renders inside a layout, and the layout has already stamped its
  // ground on <html> via useDocumentGround before the guard's first paint —
  // so the tint (or the ADMIN neutral, under AdminLayout/AccountLayout) shows
  // through the canvas. A bg-ground class here would be actively wrong: the
  // guard cannot know which ground it is about to resolve into, and painting
  // the app tint under an admin shell would reintroduce the mismatch flash
  // this issue exists to remove.
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  if (!userDoc) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  // Role-agnostic surface: signed in is the whole requirement.
  if (!role) return <>{children}</>;

  const sitRole = getSitRole(userDoc);

  if (sitRole !== role) {
    // Redirect to correct portal
    if (sitRole === 'babysitter') return <Navigate to="/babysitter" replace />;
    if (sitRole === 'parent') return <Navigate to="/family" replace />;
    if (sitRole === 'admin') return <Navigate to="/admin" replace />;
    // A study tutor with no sit role skips the role question (issue #144):
    // the welcome page enrolls them in one tap.
    if (isTutor(userDoc)) return <Navigate to="/welcome-sit" replace />;
    // Signed-in user with no sit role (foreign-profile-only) — send to /signup
    // to add a sit role rather than dead-ending at '/'.
    return <Navigate to="/signup" replace />;
  }

  // Redirect babysitters with incomplete enrollment to enrollment flow
  if (sitRole === 'babysitter' && getBabysitterProfile(userDoc)?.enrollmentComplete === false) {
    return <Navigate to="/enroll/babysitter" replace />;
  }

  return <>{children}</>;
}
