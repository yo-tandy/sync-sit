import { useTranslation } from 'react-i18next';
import { validateEjmEmail } from '@ejm/shared-core';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { InfoBanner } from '../components/InfoBanner.js';

interface StepEmailProps {
  ejemEmail: string;
  onChange: (email: string) => void;
  onSubmit: () => Promise<void>;
  loading: boolean;
  error: string | null;
  isInvite?: boolean;
  logoSrc?: string;
  logoAlt?: string;
}

export function StepEmail({
  ejemEmail,
  onChange,
  onSubmit,
  loading,
  error,
  isInvite = false,
  logoSrc,
  logoAlt,
}: StepEmailProps) {
  const { t } = useTranslation();

  const email = ejemEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = emailRegex.test(email);

  // For non-invite: validate EJM domain + graduation year
  const ejmValidation = !isInvite && email ? validateEjmEmail(email) : null;

  // FE validation error
  let validationError: string | undefined;
  if (email && !isValidEmail) {
    validationError = t('validation.validEmail');
  } else if (ejmValidation && !ejmValidation.valid) {
    validationError = ejmValidation.error;
  }

  // Improve backend error messages
  const displayError =
    error === 'Must be logged in' || error === 'UNAUTHENTICATED'
      ? t('enrollment.serverError')
      : error;

  const canSubmit = isValidEmail && (isInvite || ejmValidation?.valid === true) && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) await onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      {logoSrc && (
        <div className="mb-6 flex justify-center">
          <img src={logoSrc} alt={logoAlt ?? 'logo'} className="h-20 w-20 rounded-2xl object-cover" />
        </div>
      )}
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.verifySchool')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('enrollment.verifySchoolDesc')}
      </p>

      <Input
        label={isInvite ? t('enrollment.emailLabel') : t('enrollment.ejemEmailLabel')}
        type="email"
        value={ejemEmail}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isInvite ? 'your@email.com' : 'name@ejm.org'}
        error={validationError || displayError || undefined}
        required
      />

      {!isInvite && (
        <InfoBanner className="mb-6">
          {t('enrollment.ejemEmailHint')}
        </InfoBanner>
      )}

      <Button type="submit" disabled={!canSubmit}>
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </Button>
    </form>
  );
}
