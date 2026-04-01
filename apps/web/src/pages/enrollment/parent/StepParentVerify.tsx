import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import {} from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { CodeInput } from '@/components/forms/CodeInput';
import type { ParentFormData } from '../ParentEnrollment';

interface StepParentVerifyProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  onResend: () => void;
  loading: boolean;
  error: string | null;
}

export function StepParentVerify({ data, onChange, onNext, onResend, error }: StepParentVerifyProps) {
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resendCount, setResendCount] = useState(0);
  const [codeVerified, setCodeVerified] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
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
      await verifyFn({ email: data.email, code });
      handleCodeVerified();
      return;
    } catch (err: any) {
      setCodeError(err.message || 'Invalid verification code');
      setCodeVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  // Auto-advance when code is verified
  const handleCodeVerified = () => {
    setCodeVerified(true);
    onNext();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <MailIcon className="h-7 w-7 text-red-600" />
        </div>
        <h2 className="mb-2 text-xl font-bold">Check your email</h2>
        <p className="mb-8 text-sm text-gray-500">
          We sent a 6-digit code to
          <br />
          <strong className="text-gray-950">{data.email}</strong>
        </p>

        <CodeInput key={resendCount} onComplete={handleCodeComplete} error={codeError ?? error ?? undefined} />

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
              onClick={() => { setResendCooldown(60); setResendCount((c) => c + 1); setCodeVerified(false); setCodeError(null); onChange({ verificationCode: '' }); onResend(); }}
              className="font-medium text-red-600 hover:underline"
            >
              Resend code
            </button>
          )}
        </p>
      </div>

      {codeVerified && (
        <p className="mt-3 text-center text-sm text-green-600">✓ Code verified</p>
      )}
    </form>
  );
}
