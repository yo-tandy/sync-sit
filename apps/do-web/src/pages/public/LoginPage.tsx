import { useAuthStore } from '@/stores/authStore';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/utils/postLoginRouter';

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();

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
    />
  );
}
