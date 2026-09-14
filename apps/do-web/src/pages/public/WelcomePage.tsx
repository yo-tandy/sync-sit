import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/utils/postLoginRouter';
import { sitSignUpUrl } from '@/utils/appSwitch';

/**
 * Public landing. A signed-in user has no business here — send them to the
 * authenticated shell. postLoginRouter is the single source of truth for
 * where that is (role-aware routing arrives with the portals, plan §13).
 */
export function WelcomePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  const { i18n } = useTranslation();
  const redirectPath = firebaseUser ? postLoginRouter(userDoc) : null;
  return (
    <SharedWelcomePage
      logoSrc="/logo.png"
      logoAlt="Sync/Do"
      authLoading={loading}
      redirectPath={redirectPath}
      // issue #435 milestone, PR5: do's own role question is retired —
      // "Sign up" goes straight to sit's unified /enroll, not through do's
      // local /signup redirect hop.
      signUpTo={sitSignUpUrl(i18n.language)}
    />
  );
}
