import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/utils/postLoginRouter';
import { sitSignUpUrl } from '@/utils/appSwitch';

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();
  const { i18n } = useTranslation();

  const handleLogin = async (email: string, password: string): Promise<string | undefined> => {
    await login(email, password);
    // Role-aware landing (plan §13 PR7): the login just set userDoc on the
    // store — read it fresh so parents land in the family portal.
    return undefined;
  };

  return (
    <SharedLoginPage
      logoSrc="/logo.png"
      logoAlt="Sync/Do"
      onLogin={handleLogin}
      postLoginRouter={() => postLoginRouter(useAuthStore.getState().userDoc)}
      loading={loading}
      error={error}
      clearError={clearError}
      // issue #435 milestone, PR5: do's own role question is retired —
      // "create an account" goes straight to sit's unified /enroll, not
      // through do's local /signup redirect hop.
      signUpTo={sitSignUpUrl(i18n.language)}
    />
  );
}
