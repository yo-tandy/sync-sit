import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { checkPasswordRequirements } from '@ejm/shared-core';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

interface StepPasswordProps {
  /**
   * Called when the user has entered a valid matching password and accepted
   * consent. Orchestrator decides what "submit" means — sync-sit creates the
   * Firebase Auth account immediately via enrollBabysitter; sync-study just
   * stores the password locally because enrollTutor runs at the end of the
   * flow.
   */
  onSubmit: (password: string, consentVersion: string) => Promise<void>;
  /**
   * Consent version the user is accepting. Each app passes its own:
   * sync-sit uses '1.0', sync-study uses '2025-12-01'.
   */
  consentVersion: string;
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

export function StepPassword({ onSubmit, consentVersion, loading, error }: StepPasswordProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [consent, setConsent] = useState(false);

  const reqs = checkPasswordRequirements(password);
  const allReqsMet = reqs.minLength && reqs.hasLowercase && reqs.hasUppercase && reqs.hasNumber;
  const passwordsMatch = password === passwordConfirm && passwordConfirm.length > 0;
  const canSubmit = allReqsMet && passwordsMatch && consent && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(password, consentVersion);
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('auth.createPassword')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('auth.passwordRequirements')}</p>

      <Input
        label={t('common.password')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
      />
      <Input
        label={t('auth.confirmPassword')}
        type="password"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        error={passwordConfirm && !passwordsMatch ? t('auth.passwordMismatch') : undefined}
        autoComplete="new-password"
        required
      />

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
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        <span>
          {t('enrollment.consentAgree')}{' '}
          <Link to="/terms" target="_blank" className="text-red-600 hover:underline">
            {t('enrollment.termsOfService')}
          </Link>
          {' '}{t('enrollment.consentAnd')}{' '}
          <Link to="/privacy" target="_blank" className="text-red-600 hover:underline">
            {t('enrollment.privacyPolicy')}
          </Link>
        </span>
      </label>

      {error && <p className="mb-4 text-sm text-error-600">{error}</p>}

      <Button type="submit" disabled={!canSubmit}>
        {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
      </Button>
    </form>
  );
}
