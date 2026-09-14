import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { getStudyRole } from '@ejm/study-core';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/utils/postLoginRouter';
import { sitSignUpUrl } from '@/utils/appSwitch';

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();
  const { i18n } = useTranslation();

  const handleLogin = async (email: string, password: string): Promise<string | undefined> => {
    await login(email, password);
    return getStudyRole(useAuthStore.getState().userDoc);
  };

  return (
    <SharedLoginPage
      logoSrc="/logo.png"
      logoAlt="Sync/Study"
      onLogin={handleLogin}
      postLoginRouter={(role) => postLoginRouter(role, useAuthStore.getState().userDoc)}
      loading={loading}
      error={error}
      clearError={clearError}
      // issue #435 milestone, PR5: study's own role question is retired —
      // "create an account" goes straight to sit's unified /enroll, not
      // through study's local /signup redirect hop.
      signUpTo={sitSignUpUrl(i18n.language)}
    />
  );
}
