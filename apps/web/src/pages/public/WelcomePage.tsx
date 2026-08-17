import { useAuthStore } from '@/stores/authStore';
import { getSitRole } from '@ejm/sit-core';
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/lib/postLoginRouter';

/**
 * Public landing. A signed-in user has no business here — postLoginRouter is
 * the single source of truth: portals for role'd users (AuthGuard finishes
 * the incomplete-enrollment redirect), /welcome-sit for cross-app tutors,
 * /signup for profile-less accounts.
 */
export function WelcomePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  const redirectPath =
    firebaseUser && userDoc ? postLoginRouter(getSitRole(userDoc), userDoc) : null;
  return (
    <SharedWelcomePage
      logoSrc="/logo.png"
      logoAlt="Sync/Sit"
      authLoading={loading}
      redirectPath={redirectPath}
    />
  );
}
