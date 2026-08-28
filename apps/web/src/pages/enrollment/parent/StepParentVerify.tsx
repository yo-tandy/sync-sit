import { useState, useEffect, useRef } from 'react';
import { Trans } from 'react-i18next';
import { Link } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import {} from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { CodeInput } from '@/components/forms/CodeInput';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';
import type { ParentFormData } from '../ParentEnrollment';

interface StepParentVerifyProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  onResend: () => void;
  loading: boolean;
  error: string | null;
  /**
   * Resend-cooldown seconds. Admin-configurable (issue #250,
   * verificationCodeCooldownS): the page passes the CONFIGURED value --
   * verifyParentEmail answers cooldown repeats with a decoy success
   * (anti-enumeration), so a timer shorter than the real window would
   * re-enable a button that silently does nothing.
   */
  resendCooldownS?: number;
}

export function StepParentVerify({
  data,
  onChange,
  onNext,
  onResend,
  error,
  resendCooldownS = ADMIN_CONFIG_DEFS.verificationCodeCooldownS.default,
}: StepParentVerifyProps) {
  const [resendCooldown, setResendCooldown] = useState(resendCooldownS);
  const [resendCount, setResendCount] = useState(0);
  const [codeVerified, setCodeVerified] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  // Value the running countdown was armed with -- lets the sync effect
  // below compute elapsed time without a wall clock.
  const armedWithRef = useRef(resendCooldownS);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // The config read races mount: extend (never shorten) a running
  // countdown when the configured value lands after useState captured
  // the default. Mirrors shared-ui StepVerify.
  useEffect(() => {
    setResendCooldown((c) => {
      if (c <= 0) {
        armedWithRef.current = resendCooldownS;
        return c;
      }
      const elapsed = armedWithRef.current - c;
      armedWithRef.current = resendCooldownS;
      return Math.max(c, resendCooldownS - elapsed);
    });
  }, [resendCooldownS]);

  const handleCodeComplete = async (code: string) => {
    onChange({ verificationCode: code });
    setCodeError(null);
    setVerifying(true);
    try {
      const verifyFn = httpsCallable(functions, 'verifyCode');
      await verifyFn({ email: data.email, code });
      handleCodeVerified();
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid verification code';
      setCodeError(message);
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
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
          <MailIcon className="h-7 w-7 text-brand-600" />
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
            <span className="text-brand-600">Resend in {resendCooldown}s</span>
          ) : (
            <button
              type="button"
              onClick={() => { armedWithRef.current = resendCooldownS; setResendCooldown(resendCooldownS); setResendCount((c) => c + 1); setCodeVerified(false); setCodeError(null); onChange({ verificationCode: '' }); onResend(); }}
              className="font-medium text-brand-600 hover:underline"
            >
              Resend code
            </button>
          )}
        </p>

        {/* Always rendered, on BOTH the fresh and silent existing-account
            paths (issue #148) — a static, non-distinguishing exit for users
            whose account already exists and who therefore never get a code. */}
        <p className="mt-2 text-sm text-gray-500">
          <Trans
            i18nKey="enrollment.verifyNoCodeHint"
            components={{
              loginLink: <Link to="/login" className="font-medium text-brand-600 hover:underline" />,
            }}
          />
        </p>
      </div>

      {codeVerified && (
        <p className="mt-3 text-center text-sm text-green-600">✓ Code verified</p>
      )}
    </form>
  );
}
