import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import type { ParentFormData } from '../ParentEnrollment';

interface StepParentEmailProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepParentEmail({ data, onChange, onNext, loading, error }: StepParentEmailProps) {
  const { t } = useTranslation();
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <div className="mb-6 flex justify-center">
        <img src="/logo.png" alt="Sync/Sit" className="h-20 w-20 rounded-2xl" />
      </div>
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.yourAccount')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('enrollment.yourAccountDesc')}
      </p>

      <Input
        label={t('enrollment.emailLabel')}
        type="email"
        value={data.email}
        onChange={(e) => onChange({ email: e.target.value })}
        placeholder="your@email.com"
        error={error ?? undefined}
        required
      />

      <Button type="submit" disabled={loading || !data.email}>
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </Button>
    </form>
  );
}
