import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { getStudyRole } from '@ejm/study-core';
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/utils/postLoginRouter';
import { sitSignUpUrl } from '@/utils/appSwitch';

/**
 * Public landing. A signed-in user has no business here — send them where
 * they belong: role'd users to their portal, cross-app arrivals into the
 * welcome/enroll routing, profile-less accounts to role selection. All of
 * that is postLoginRouter's single source of truth.
 */
export function WelcomePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  const { i18n } = useTranslation();
  const redirectPath =
    firebaseUser && userDoc ? postLoginRouter(getStudyRole(userDoc), userDoc) : null;
  return (
    <SharedWelcomePage
      logoSrc="/logo.png"
      logoAlt="Sync/Study"
      authLoading={loading}
      redirectPath={redirectPath}
      // issue #435 milestone, PR5: study's own role question is retired —
      // "Sign up" goes straight to sit's unified /enroll, not through
      // study's local /signup redirect hop.
      signUpTo={sitSignUpUrl(i18n.language)}
    />
  );
}
