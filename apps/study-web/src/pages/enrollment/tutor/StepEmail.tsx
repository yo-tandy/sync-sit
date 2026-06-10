import { useTranslation } from 'react-i18next';
import { Button, Input, InfoBanner } from '@ejm/shared-ui';
import { validateEjmEmail } from '@ejm/shared';

interface StepEmailProps {
  ejemEmail: string;
  onChange: (email: string) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepEmail({ ejemEmail, onChange, onNext, loading, error }: StepEmailProps) {
  const { t } = useTranslation();

  const email = ejemEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = emailRegex.test(email);
  const ejmValidation = email ? validateEjmEmail(email) : null;

  let validationError: string | undefined;
  if (email && !isValidEmail) {
    validationError = t('validation.validEmail');
  } else if (ejmValidation && !ejmValidation.valid) {
    validationError = ejmValidation.error;
  }

  const displayError =
    error === 'Must be logged in' || error === 'UNAUTHENTICATED'
      ? t('enrollment.serverError')
      : error;

  const canSubmit = isValidEmail && ejmValidation?.valid === true && !loading;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <div className="mb-6 flex justify-center">
        <img src="/logo.png" alt="Sync/Study" className="h-20 w-20 rounded-2xl object-cover" />
      </div>
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.verifySchool')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('enrollment.verifySchoolDesc')}
      </p>

      <Input
        label={t('enrollment.ejemEmailLabel')}
        type="email"
        value={ejemEmail}
        onChange={(e) => onChange(e.target.value)}
        placeholder="name@ejm.org"
        error={validationError || displayError || undefined}
        required
      />

      <InfoBanner className="mb-6">
        {t('enrollment.ejemEmailHint')}
      </InfoBanner>

      <Button type="submit" disabled={!canSubmit}>
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </Button>
    </form>
  );
}
