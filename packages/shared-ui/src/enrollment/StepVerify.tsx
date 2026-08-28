import { useState, useEffect, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router';
import { MailIcon } from '../components/Icons.js';
import { CodeInput } from '../forms/CodeInput.js';
import { enrollmentErrorReason } from '../utils/callableErrors.js';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';

interface StepVerifyProps {
  ejemEmail: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  error: string | null;
  /**
   * Resend-cooldown seconds. Admin-configurable (issue #250,
   * verificationCodeCooldownS): pages pass the CONFIGURED value read via
   * their app's config reader -- the server's cooldown path answers
   * repeats with a decoy success (anti-enumeration), so a timer shorter
   * than the real window would re-enable a button that silently does
   * nothing. Defaults to the table's default.
   */
  resendCooldownS?: number;
}

export function StepVerify({
  ejemEmail,
  onVerify,
  onResend,
  error,
  resendCooldownS = ADMIN_CONFIG_DEFS.verificationCodeCooldownS.default,
}: StepVerifyProps) {
  const { t } = useTranslation();
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(resendCooldownS);
  const [resendCount, setResendCount] = useState(0);
  const [verifying, setVerifying] = useState(false);
  // Value the running countdown was armed with -- lets the sync effect
  // below compute elapsed time without a wall clock.
  const armedWithRef = useRef(resendCooldownS);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // The config read races mount: useState captures whatever value had
  // resolved by then. When the configured value lands mid-countdown,
  // extend the running timer by the difference (never shorten -- the
  // floor guarantees configured >= default, and a shorter timer would
  // re-enable the decoy-success resend early).
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
    if (verifying) return;
    setCodeError(null);
    setVerifying(true);
    try {
      await onVerify(code);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.invalidCode');
      setCodeError(message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    armedWithRef.current = resendCooldownS;
    setResendCooldown(resendCooldownS);
    setResendCount((c) => c + 1);
    setCodeError(null);
    try {
      await onResend();
    } catch (err: unknown) {
      if (enrollmentErrorReason(err) === 'send-cap') {
        // The authed own-email bypass allowance tripped (issue #155):
        // surface it — this is the one resend failure the user can act on,
        // and it is only ever thrown to an authenticated caller for their
        // OWN address, so showing it distinguishes nothing (unauthenticated
        // paths stay silent by design). Keep the 60s cooldown ticking:
        // an immediate retry cannot succeed within the hour anyway.
        setCodeError(t('enrollment.sendCapReached'));
        return;
      }
      // Transport and other failures — reset cooldown so user can retry
      // immediately. Don't surface the error here; orchestrator's error
      // prop will if it wants.
      setResendCooldown(0);
    }
  };

  return (
    <div className="px-6 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
        <MailIcon className="h-7 w-7 text-brand-600" />
      </div>
      <h2 className="mb-2 text-xl font-bold">{t('auth.checkEmail')}</h2>
      <p className="mb-8 text-sm text-gray-500">
        {t('auth.codeSentTo')}
        <br />
        <strong className="text-gray-950">{ejemEmail}</strong>
      </p>

      <CodeInput
        key={resendCount}
        onComplete={handleCodeComplete}
        error={codeError ?? error ?? undefined}
      />

      {verifying && (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-gray-500">
          {t('auth.verifying')}
        </p>
      )}

      <p className="mt-4 text-sm text-gray-500">
        {t('auth.didntReceive')}{' '}
        {resendCooldown > 0 ? (
          <span className="text-brand-600">{t('auth.resendIn', { seconds: resendCooldown })}</span>
        ) : (
          <button type="button" onClick={handleResend} className="font-medium text-brand-600 hover:underline">
            {t('auth.resendCode')}
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
  );
}
