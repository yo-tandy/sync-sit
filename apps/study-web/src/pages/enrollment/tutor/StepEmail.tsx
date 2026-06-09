import { useTranslation } from 'react-i18next';
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

  const canSubmit = isValidEmail && (ejmValidation?.valid === true) && !loading;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.verifySchool')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('enrollment.verifySchoolDesc')}
      </p>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('enrollment.ejemEmailLabel')}
        </label>
        <input
          type="email"
          value={ejemEmail}
          onChange={(e) => onChange(e.target.value)}
          placeholder="name28@ejm.org"
          className={`h-12 w-full rounded-lg border-[1.5px] bg-white px-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600 ${
            validationError ? 'border-red-600' : 'border-gray-300'
          }`}
          required
        />
        {(validationError || error) && (
          <p className="mt-1.5 text-xs text-red-600">{validationError ?? error}</p>
        )}
      </div>

      <p className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
        {t('enrollment.ejemEmailHint')}
      </p>

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex h-[52px] w-full items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90 disabled:opacity-50"
      >
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </button>
    </form>
  );
}
