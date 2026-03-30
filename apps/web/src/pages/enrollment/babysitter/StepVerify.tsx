import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { Button, Input } from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { CodeInput } from '@/components/forms/CodeInput';
import type { BabysitterFormData } from '../BabysitterEnrollment';

interface StepVerifyProps {
  data: BabysitterFormData;
  onChange: (partial: Partial<BabysitterFormData>) => void;
  onNext: () => void;
  onResend: () => void;
  loading: boolean;
  error: string | null;
}

export function StepVerify({ data, onChange, onNext, onResend, loading, error }: StepVerifyProps) {
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resendCount, setResendCount] = useState(0);
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [codeVerified, setCodeVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleCodeComplete = async (code: string) => {
    onChange({ verificationCode: code });
    setCodeError(null);
    setVerifying(true);
    try {
      const verifyFn = httpsCallable(functions, 'verifyCode');
      await verifyFn({ email: data.ejemEmail, code });
      setCodeVerified(true);
    } catch (err: any) {
      setCodeError(err.message || 'Invalid verification code');
      setCodeVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    setResendCooldown(60);
    setResendCount((c) => c + 1);
    setCodeVerified(false);
    onChange({ verificationCode: '' });
    setCodeError(null);
    onResend();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeVerified) return;
    if (data.password.length < 8) return;
    if (data.password !== passwordConfirm) return;
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      {/* Code section */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <MailIcon className="h-7 w-7 text-red-600" />
        </div>
        <h2 className="mb-2 text-xl font-bold">Check your email</h2>
        <p className="mb-8 text-sm text-gray-500">
          We sent a 6-digit code to
          <br />
          <strong className="text-gray-950">{data.ejemEmail}</strong>
        </p>

        <CodeInput
          key={resendCount}
          onComplete={handleCodeComplete}
          error={codeError ?? error ?? undefined}
        />

        {verifying && (
          <p className="mt-3 text-sm text-gray-500">Verifying...</p>
        )}

        {codeVerified && (
          <p className="mt-3 text-sm text-green-600">✓ Code verified</p>
        )}

        <p className="mt-4 text-sm text-gray-500">
          Didn't receive it?{' '}
          {resendCooldown > 0 ? (
            <span className="text-red-600">Resend in {resendCooldown}s</span>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              className="font-medium text-red-600 hover:underline"
            >
              Resend code
            </button>
          )}
        </p>
      </div>

      {/* Password section — shown only after code is verified */}
      {codeVerified && (
        <div className="border-t border-gray-200 pt-6">
          <h3 className="mb-4 text-lg font-semibold">Create your password</h3>
          <Input
            label="Password"
            type="password"
            value={data.password}
            onChange={(e) => onChange({ password: e.target.value })}
            placeholder="Min. 8 characters"
            error={data.password && data.password.length < 8 ? 'Password must be at least 8 characters' : undefined}
            required
          />
          <Input
            label="Confirm password"
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="Re-enter your password"
            error={passwordConfirm && data.password !== passwordConfirm ? "Passwords don't match" : undefined}
            required
          />
          <Button
            type="submit"
            disabled={loading || data.password.length < 8 || data.password !== passwordConfirm}
          >
            Continue
          </Button>
        </div>
      )}
    </form>
  );
}
