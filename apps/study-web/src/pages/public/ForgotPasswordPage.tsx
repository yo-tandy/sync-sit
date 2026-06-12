import { useAuthStore } from '@/stores/authStore';
import { ForgotPasswordPage as SharedForgotPasswordPage } from '@ejm/shared-ui';

export function ForgotPasswordPage() {
  const { resetPassword, error, clearError } = useAuthStore();
  return <SharedForgotPasswordPage onSubmit={resetPassword} error={error} clearError={clearError} />;
}
