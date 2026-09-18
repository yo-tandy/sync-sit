import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { Spinner } from '@/components/ui';
import { getSitRole } from '@ejm/sit-core';
import { isTutor, needsReconsent } from '@ejm/shared-core';
import { ConsentGateHost } from '@/components/ConsentGateHost';

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

  // Re-consent gate (issue #488 decision 1): the consent documents were
  // bumped after this member last accepted them. Nothing of the app renders
  // -- not even the role-less hub -- until they accept the current ones or
  // sign out. Before role routing on purpose: a stale record is stale in
  // every portal.
  if (needsReconsent(userDoc)) return <ConsentGateHost />;

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

  // NO enrollment-completeness ejection (issue #537 D8). This guard used to
  // send any babysitter with `enrollmentComplete === false` straight back to
  // /enroll/babysitter, which made the offering step's own "Skip for now"
  // unusable: skipping could only work by claiming the enrollment WAS
  // complete, so the flag lied and a skipped profile could later be flipped
  // searchable with no rate, no kid ages and no area.
  //
  // #537 makes the offering stage skippable by design — "it just means that
  // the account is not active on that sub app" — so completeness is a
  // VISIBILITY question, not an access question. `computeEffectiveSearchable`
  // already refuses to surface an incomplete profile whatever the user's own
  // toggle says, and the dashboard already renders the "Complete your profile
  // to become visible to families" CTA. Both keep working; only the coercion
  // is gone.
  //
  // This converges sit onto study's guard, which has always passed incomplete
  // tutors through with the same reasoning stated in its own comment: gating
  // search activation is the dashboard's job, never the guard's.

  return <>{children}</>;
}
