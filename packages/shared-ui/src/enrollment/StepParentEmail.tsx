import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

interface StepParentEmailProps {
  email: string;
  onChange: (email: string) => void;
  onSubmit: () => Promise<void>;
  loading: boolean;
  error: string | null;
  logoSrc?: string;
  logoAlt?: string;
}

/**
 * Parent email step of the shared parent wizard (issue #440, PR1).
 *
 * A plain, any-domain address — unlike `StepEmail`, which is EJM-domain
 * specific (school verification + graduation year) and whose `isInvite`
 * mode carries invite copy. Parents are not EJM members; the backend
 * (`verifyParentEmail`) accepts any mailbox and answers an existing account
 * with a decoy success (issue #148), so this step never shows an
 * account-exists branch. It also does no auth-failure rewrite: the callable
 * is unauthenticated by design, so the only errors it ever shows are its
 * own validation and whatever the orchestrator hands down.
 *
 * Replaces the two per-app copies (`apps/web` and `apps/study-web`
 * `StepParentEmail`), which had drifted only in their logo.
 */
export function StepParentEmail({
  email,
  onChange,
  onSubmit,
  loading,
  error,
  logoSrc,
  logoAlt,
}: StepParentEmailProps) {
  const { t } = useTranslation();

  const normalized = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = emailRegex.test(normalized);

  const validationError = normalized && !isValidEmail ? t('validation.validEmail') : undefined;
  const canSubmit = isValidEmail && !loading;

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
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.yourAccount')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">{t('enrollment.yourAccountDesc')}</p>

      <Input
        label={t('enrollment.emailLabel')}
        type="email"
        value={email}
        onChange={(e) => onChange(e.target.value)}
        placeholder="your@email.com"
        error={validationError || error || undefined}
        required
      />

      <Button type="submit" disabled={!canSubmit}>
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </Button>
    </form>
  );
}
