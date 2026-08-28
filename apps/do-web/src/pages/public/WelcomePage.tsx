import { useAuthStore } from '@/stores/authStore';
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/utils/postLoginRouter';

/**
 * Public landing. A signed-in user has no business here — send them to the
 * authenticated shell. postLoginRouter is the single source of truth for
 * where that is (role-aware routing arrives with the portals, plan §13).
 */
export function WelcomePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  const redirectPath = firebaseUser ? postLoginRouter(userDoc) : null;
  return (
    <SharedWelcomePage
      logoSrc="/logo.png"
      logoAlt="Sync/Do"
      authLoading={loading}
      redirectPath={redirectPath}
    />
  );
}
