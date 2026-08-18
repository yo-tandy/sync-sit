import { useTranslation } from 'react-i18next';
import { Button, Input } from '@ejm/shared-ui';

// Parent email step — a plain email address, unlike the tutor flow's shared
// StepEmail which is EJM-domain-specific (school verification + graduation
// year). Mirrors sync-sit's StepParentEmail.

interface StepParentEmailProps {
  email: string;
  onChange: (email: string) => void;
  onSubmit: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function StepParentEmail({ email, onChange, onSubmit, loading, error }: StepParentEmailProps) {
  const { t } = useTranslation();

  const normalized = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = emailRegex.test(normalized);

  // No auth-failure rewrite here (unlike sit's copy of this step):
  // verifyParentEmail is unauthenticated by design, so the only errors this
  // step ever shows are its own messages.
  const validationError = normalized && !isValidEmail ? t('validation.validEmail') : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isValidEmail && !loading) await onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <div className="mb-6 flex justify-center">
        <img src="/logo.png" alt="Sync/Study" className="h-20 w-20 rounded-2xl object-cover" />
      </div>
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.yourAccount')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('enrollment.yourAccountDesc')}
      </p>

      <Input
        label={t('enrollment.emailLabel')}
        type="email"
        value={email}
        onChange={(e) => onChange(e.target.value)}
        placeholder="your@email.com"
        error={validationError || error || undefined}
        required
      />

      <Button type="submit" disabled={loading || !isValidEmail}>
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </Button>
    </form>
  );
}
