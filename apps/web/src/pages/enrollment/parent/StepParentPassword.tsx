import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import type { ParentFormData } from '../ParentEnrollment';

interface StepParentPasswordProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  error: string | null;
}

export function StepParentPassword({ data, onChange, onNext, error }: StepParentPasswordProps) {
  const { t } = useTranslation();
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (data.password.length >= 8 && data.password === passwordConfirm) {
      onNext();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('auth.createPassword')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('auth.passwordMin')}
      </p>

      <Input
        label={t('common.password')}
        type="password"
        value={data.password}
        onChange={(e) => onChange({ password: e.target.value })}
        placeholder={t('auth.passwordMin')}
        error={data.password && data.password.length < 8 ? t('auth.passwordTooShort') : undefined}
        required
      />
      <Input
        label={t('auth.confirmPassword')}
        type="password"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        placeholder={t('auth.confirmPassword')}
        error={passwordConfirm && data.password !== passwordConfirm ? t('auth.passwordMismatch') : undefined}
        required
      />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={data.password.length < 8 || data.password !== passwordConfirm}>
        {t('common.continue')}
      </Button>
    </form>
  );
}
