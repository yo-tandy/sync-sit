import { useAuthStore } from '@/stores/authStore';
import { getStudyRole } from '@ejm/study-core';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';

function postLoginRouter(role: string | undefined): string {
  if (role === 'tutor') return '/tutor';
  // study-web has no /family route — a sit parent must add a study role via
  // /signup rather than 404 on /family.
  if (role === 'parent') return '/signup';
  if (role === 'admin') return '/admin';
  // Foreign-profile-only users (no study role) go to /signup, not dead-end '/'.
  return '/signup';
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
