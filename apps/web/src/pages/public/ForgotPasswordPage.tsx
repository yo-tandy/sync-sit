import { useState } from 'react';
import { TopNav, Button, Input, InfoBanner } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { resetPassword, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await resetPassword(email);
      setSent(true);
    } catch {
      // Error is set in the store
    }
  };

  if (sent) {
    return (
      <div>
        <TopNav title="Reset Password" backTo="/login" />
        <div className="px-6 pt-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <span className="text-2xl">✉️</span>
          </div>
          <h2 className="mb-2 text-xl font-bold">Check your email</h2>
          <p className="mb-6 text-sm text-gray-500">
            We sent a password reset link to <strong className="text-gray-950">{email}</strong>
          </p>
          <InfoBanner icon="ℹ️">
            Check your inbox for a link to reset your password. If you don't see
            it, check your spam folder.
          </InfoBanner>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title="Reset Password" backTo="/login" />
      <div className="px-6 pt-8">
        <h2 className="mb-2 text-2xl font-bold">Forgot your password?</h2>
        <p className="mb-8 text-sm text-gray-500">
          Enter your email and we'll send you a link to reset it.
        </p>

        <form onSubmit={handleSubmit}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError();
            }}
            placeholder="your@email.com"
            error={error ?? undefined}
            required
          />
          <Button type="submit">Send reset link</Button>
        </form>
      </div>
    </div>
  );
}
