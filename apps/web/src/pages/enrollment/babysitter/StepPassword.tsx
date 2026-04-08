import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import { checkPasswordRequirements } from '@ejm/shared';

interface StepPasswordProps {
  onCreateAccount: (password: string, consentVersion: string) => void;
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

export function StepPassword({ onCreateAccount, loading, error }: StepPasswordProps) {
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
    onCreateAccount(password, '1.0');
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('auth.createPassword')}</h2>
      <p className="mb-6 text-sm text-gray-500">
        {t('auth.passwordRequirements')}
      </p>

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
    </form>
  );
}
