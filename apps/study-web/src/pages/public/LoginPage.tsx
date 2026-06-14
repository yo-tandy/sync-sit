import { useAuthStore } from '@/stores/authStore';
import { getStudyRole } from '@ejm/study-core';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';

function postLoginRouter(role: string | undefined): string {
  if (role === 'tutor') return '/tutor';
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  return '/';
}

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();

  const handleLogin = async (email: string, password: string): Promise<string | undefined> => {
    await login(email, password);
    return getStudyRole(useAuthStore.getState().userDoc);
  };

  return (
    <SharedLoginPage
      logoSrc="/logo.png"
      logoAlt="Sync/Study"
      onLogin={handleLogin}
      postLoginRouter={postLoginRouter}
      loading={loading}
      error={error}
      clearError={clearError}
    />
  );
}
