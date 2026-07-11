import { Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { getStudyRole } from '@ejm/study-core';

type StudyRole = 'tutor' | 'parent' | 'admin';

interface AuthGuardProps {
  role: StudyRole;
  children: React.ReactNode;
}

/**
 * Route guard for sync-study portals. Copy-adapted from sync-sit's AuthGuard
 * (apps/web) with one DELIBERATE DIVERGENCE, see below.
 */
export function AuthGuard({ role, children }: AuthGuardProps) {
  const { firebaseUser, userDoc, loading } = useAuthStore();

  // Auth state still resolving: render nothing rather than flashing a redirect
  // before we know who the visitor is.
  if (loading) return null;

  // Not signed in at all -> the login page.
  if (!firebaseUser) return <Navigate to="/login" replace />;

  const studyRole = getStudyRole(userDoc);

  // DELIBERATE DIVERGENCE from sync-sit's babysitter guard: we do NOT eject
  // tutors with incomplete enrollment or an unapproved/pending/rejected
  // identity. getStudyRole returns 'tutor' whenever a tutor profile exists at
  // all, so an unapproved tutor (enrollmentComplete === false, any
  // identityStatus, or verification absent on pre-#77 tutors) passes this check
  // and reaches the portal. Surfacing and gating on verification state is the
  // dashboard's job (PR #77 state contract), never the guard's.
  if (studyRole !== role) {
    // Non-tutor fallback mirrors LoginPage.postLoginRouter so the guard and the
    // post-login router agree: admins to /admin; everyone else (study parents,
    // and foreign sit-only accounts with no study role) to /signup to add a
    // study role rather than dead-ending. study-web has no /family route.
    if (studyRole === 'admin') return <Navigate to="/admin" replace />;
    return <Navigate to="/signup" replace />;
  }

  return <>{children}</>;
}
