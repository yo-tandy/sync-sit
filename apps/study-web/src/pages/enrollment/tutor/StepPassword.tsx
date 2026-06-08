import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkPasswordRequirements } from '@ejm/shared';

interface StepPasswordProps {
  onNext: (password: string) => void;
  loading: boolean;
  error: string | null;
}

function Req({ met, label }: { met: boolean; label: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-400'}`}>
      <span>{met ? '✓' : '○'}</span> {label}
    </p>
  );
}

export function StepPassword({ onNext, loading, error }: StepPasswordProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [consent, setConsent] = useState(false);

  const reqs = checkPasswordRequirements(password);
  const allReqsMet = reqs.minLength && reqs.hasLowercase && reqs.hasUppercase && reqs.hasNumber;
  const passwordsMatch = password === passwordConfirm && passwordConfirm.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allReqsMet || !passwordsMatch || !consent) return;
    onNext(password);
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('auth.createPassword')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('auth.passwordRequirements')}</p>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('common.password')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
          required
        />
      </div>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('auth.confirmPassword')}</label>
        <input
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          className={`h-12 w-full rounded-lg border-[1.5px] bg-white px-4 text-base outline-none transition-colors focus:border-red-600 ${
            passwordConfirm && !passwordsMatch ? 'border-red-600' : 'border-gray-300'
          }`}
          required
        />
        {passwordConfirm && !passwordsMatch && (
          <p className="mt-1.5 text-xs text-red-600">{t('auth.passwordMismatch')}</p>
        )}
      </div>

      {password.length > 0 && (
        <div className="mb-5 space-y-1">
          <Req met={reqs.minLength} label={t('auth.passwordMinLength')} />
          <Req met={reqs.hasLowercase} label={t('auth.passwordHasLowercase')} />
          <Req met={reqs.hasUppercase} label={t('auth.passwordHasUppercase')} />
          <Req met={reqs.hasNumber} label={t('auth.passwordHasNumber')} />
        </div>
      )}

      <label className="mb-6 flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300"
        />
        <span>
          {t('enrollment.consentAgree')}{' '}
          <a href="/terms" target="_blank" className="text-red-600 hover:underline">{t('enrollment.termsOfService')}</a>
          {' '}{t('enrollment.consentAnd')}{' '}
          <a href="/privacy" target="_blank" className="text-red-600 hover:underline">{t('enrollment.privacyPolicy')}</a>
        </span>
      </label>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !allReqsMet || !passwordsMatch || !consent}
        className="flex h-[52px] w-full items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90 disabled:opacity-50"
      >
        {loading ? t('auth.creatingAccount') : t('common.continue')}
      </button>
    </form>
  );
}
