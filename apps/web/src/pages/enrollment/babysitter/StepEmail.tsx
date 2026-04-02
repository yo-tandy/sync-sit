import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Button, Input, InfoBanner } from '@/components/ui';
import type { BabysitterFormData } from '../BabysitterEnrollment';

interface StepEmailProps {
  data: BabysitterFormData;
  onChange: (partial: Partial<BabysitterFormData>) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepEmail({ data, onChange, onNext, loading, error }: StepEmailProps) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const isInvite = searchParams.get('invite') === 'true';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <div className="mb-6 flex justify-center">
        <img src="/logo.png" alt="Sync/Sit" className="h-20 w-20 rounded-2xl" />
      </div>
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.verifySchool')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('enrollment.verifySchoolDesc')}
      </p>

      <Input
        label={isInvite ? t('enrollment.emailLabel') : t('enrollment.ejemEmailLabel')}
        type="email"
        value={data.ejemEmail}
        onChange={(e) => onChange({ ejemEmail: e.target.value })}
        placeholder={isInvite ? 'your@email.com' : 'name@ejm.org'}
        error={error ?? undefined}
        required
      />

      {!isInvite && (
        <InfoBanner className="mb-6">
          {t('enrollment.ejemEmailHint')}
        </InfoBanner>
      )}

      <Button type="submit" disabled={loading || !data.ejemEmail}>
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </Button>
    </form>
  );
}
