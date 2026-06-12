import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '../components/TopNav.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { InfoBanner } from '../components/InfoBanner.js';

interface ForgotPasswordPageProps {
  onSubmit: (email: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

export function ForgotPasswordPage({ onSubmit, error, clearError }: ForgotPasswordPageProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onSubmit(email);
      setSent(true);
    } catch {
      // error set by caller
    }
  };

  if (sent) {
    return (
      <div>
        <TopNav title={t('auth.forgotPasswordTitle')} backTo="/login" />
        <div className="px-6 pt-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <span className="text-2xl">✉️</span>
          </div>
          <h2 className="mb-2 text-xl font-bold">{t('auth.checkEmailHeading')}</h2>
          <p className="mb-6 text-sm text-gray-500">
            {t('auth.checkEmailDesc')} <strong className="text-gray-950">{email}</strong>
          </p>
          <InfoBanner icon="ℹ️">{t('auth.checkEmailHint')}</InfoBanner>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('auth.forgotPasswordTitle')} backTo="/login" />
      <div className="px-6 pt-8">
        <h2 className="mb-2 text-2xl font-bold">{t('auth.forgotPasswordHeading')}</h2>
        <p className="mb-8 text-sm text-gray-500">{t('auth.forgotPasswordDesc')}</p>

        <form onSubmit={handleSubmit}>
          <Input
            label={t('common.email')}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearError(); }}
            placeholder="your@email.com"
            error={error ?? undefined}
            required
          />
          <Button type="submit">{t('auth.forgotPasswordSubmit')}</Button>
        </form>
      </div>
    </div>
  );
}
