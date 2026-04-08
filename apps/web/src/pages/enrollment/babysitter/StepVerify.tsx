import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { MailIcon } from '@/components/ui/Icons';
import { CodeInput } from '@/components/forms/CodeInput';

interface StepVerifyProps {
  ejemEmail: string;
  onVerified: (verificationCode: string) => void;
  onResend: () => void;
  error: string | null;
}

export function StepVerify({ ejemEmail, onVerified, onResend, error }: StepVerifyProps) {
  const { t } = useTranslation();
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resendCount, setResendCount] = useState(0);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleCodeComplete = async (code: string) => {
    setCodeError(null);
    setVerifying(true);
    try {
      const verifyFn = httpsCallable(functions, 'verifyCode');
      await verifyFn({ email: ejemEmail, code });
      onVerified(code);
    } catch (err: any) {
      setCodeError(err.message || t('auth.invalidCode'));
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    setResendCooldown(60);
    setResendCount((c) => c + 1);
    setCodeError(null);
    onResend();
  };

  return (
    <div className="px-6 text-center">
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
  );
}
