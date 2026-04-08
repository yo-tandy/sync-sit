import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { Button, Input } from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { CodeInput } from '@/components/forms/CodeInput';
import { checkPasswordRequirements } from '@ejm/shared';

interface StepVerifyProps {
  ejemEmail: string;
  onCreateAccount: (verificationCode: string, password: string, consentVersion: string) => void;
  onResend: () => void;
  loading: boolean;
  error: string | null;
}

export function StepVerify({ ejemEmail, onCreateAccount, onResend, loading, error }: StepVerifyProps) {
  const { t } = useTranslation();
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resendCount, setResendCount] = useState(0);
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [codeVerified, setCodeVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [consent, setConsent] = useState(false);

  const reqs = checkPasswordRequirements(password);
  const allReqsMet = reqs.minLength && reqs.hasLowercase && reqs.hasUppercase && reqs.hasNumber;
  const passwordsMatch = password === passwordConfirm && passwordConfirm.length > 0;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleCodeComplete = async (code: string) => {
    setVerificationCode(code);
    setCodeError(null);
    setVerifying(true);
    try {
      const verifyFn = httpsCallable(functions, 'verifyCode');
      await verifyFn({ email: ejemEmail, code });
      setCodeVerified(true);
    } catch (err: any) {
      setCodeError(err.message || t('auth.invalidCode'));
      setCodeVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    setResendCooldown(60);
    setResendCount((c) => c + 1);
    setCodeVerified(false);
    setVerificationCode('');
    setCodeError(null);
    onResend();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeVerified || !allReqsMet || !passwordsMatch || !consent) return;
    onCreateAccount(verificationCode, password, '1.0');
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      {/* Code section */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <MailIcon className="h-7 w-7 text-red-600" />
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
          <p className="mt-3 text-sm text-gray-500">{t('auth.verifying')}</p>
        )}

        {codeVerified && (
          <p className="mt-3 text-sm text-green-600">✓ {t('auth.codeVerified')}</p>
        )}

        <p className="mt-4 text-sm text-gray-500">
          {t('auth.didntReceive')}{' '}
          {resendCooldown > 0 ? (
            <span className="text-red-600">{t('auth.resendIn', { seconds: resendCooldown })}</span>
          ) : (
            <button type="button" onClick={handleResend} className="font-medium text-red-600 hover:underline">
              {t('auth.resendCode')}
            </button>
          )}
        </p>
      </div>

      {/* Password + Consent — shown after code verified */}
      {codeVerified && (
        <div className="border-t border-gray-200 pt-6">
          <h3 className="mb-4 text-lg font-semibold">{t('auth.createPassword')}</h3>
          <Input
            label={t('common.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label={t('auth.confirmPassword')}
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            error={passwordConfirm && !passwordsMatch ? t('auth.passwordMismatch') : undefined}
            required
          />

          {/* Password requirements checklist */}
          {password.length > 0 && (
            <div className="mb-5 space-y-1">
              <p className="text-xs font-medium text-gray-500">{t('auth.passwordRequirements')}</p>
              <Req met={reqs.minLength} label={t('auth.passwordMinLength')} />
              <Req met={reqs.hasLowercase} label={t('auth.passwordHasLowercase')} />
              <Req met={reqs.hasUppercase} label={t('auth.passwordHasUppercase')} />
              <Req met={reqs.hasNumber} label={t('auth.passwordHasNumber')} />
            </div>
          )}

          {/* Consent */}
          <label className="mb-6 flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            <span>
              {t('enrollment.consentAgree')}{' '}
              <Link to="/terms" target="_blank" className="text-red-600 hover:underline">{t('enrollment.termsOfService')}</Link>
              {' '}{t('enrollment.consentAnd')}{' '}
              <Link to="/privacy" target="_blank" className="text-red-600 hover:underline">{t('enrollment.privacyPolicy')}</Link>
            </span>
          </label>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <Button
            type="submit"
            disabled={loading || !allReqsMet || !passwordsMatch || !consent}
          >
            {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
          </Button>
        </div>
      )}
    </form>
  );
}

function Req({ met, label }: { met: boolean; label: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-400'}`}>
      <span>{met ? '✓' : '○'}</span> {label}
    </p>
  );
}
