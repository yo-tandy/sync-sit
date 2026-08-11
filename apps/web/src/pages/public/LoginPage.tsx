import { useAuthStore } from '@/stores/authStore';
import { getSitRole } from '@ejm/sit-core';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';
import { postLoginRouter } from '@/lib/postLoginRouter';

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();

  const handleLogin = async (email: string, password: string): Promise<string | undefined> => {
    await login(email, password);
    return getSitRole(useAuthStore.getState().userDoc);
  };

  return (
    <SharedLoginPage
      logoSrc="/logo.png"
      logoAlt="Sync/Sit"
      onLogin={handleLogin}
      postLoginRouter={postLoginRouter}
      loading={loading}
      error={error}
      clearError={clearError}
    />
  );
}
