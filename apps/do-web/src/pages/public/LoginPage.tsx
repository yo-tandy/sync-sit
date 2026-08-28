import { useAuthStore } from '@/stores/authStore';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/utils/postLoginRouter';

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();

  const handleLogin = async (email: string, password: string): Promise<string | undefined> => {
    await login(email, password);
    // No do-specific role model yet (plan §13 PR4): every signed-in account
    // lands on the shell home, so the role result is unused.
    return undefined;
  };

  return (
    <SharedLoginPage
      logoSrc="/logo.png"
      logoAlt="Sync/Do"
      onLogin={handleLogin}
      postLoginRouter={() => postLoginRouter()}
      loading={loading}
      error={error}
      clearError={clearError}
    />
  );
}
