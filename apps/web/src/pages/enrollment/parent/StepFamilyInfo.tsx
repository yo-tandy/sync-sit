import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Input, Textarea, Checkbox } from '@/components/ui';
import { AddressAutocomplete } from '@/components/forms/AddressAutocomplete';
import type { ParentFormData } from '../ParentEnrollment';

interface StepFamilyInfoProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  loading?: boolean;
  error: string | null;
}

export function StepFamilyInfo({ data, onChange, onNext, loading, error }: StepFamilyInfoProps) {
  const { t } = useTranslation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const isValid = data.familyName && data.firstName && data.address && data.consentAccepted;

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.yourFamily')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.yourFamilyDesc')}</p>

      <Input
        label={t('enrollment.familyName')}
        value={data.familyName}
        onChange={(e) => onChange({ familyName: e.target.value })}
        required
      />

      <Input
        label={t('enrollment.lastName')}
        value={data.lastName}
        onChange={(e) => onChange({ lastName: e.target.value })}
      />

      <Input
        label={t('enrollment.firstName')}
        value={data.firstName}
        onChange={(e) => onChange({ firstName: e.target.value })}
        required
      />

      <AddressAutocomplete
        value={data.address}
        onChange={(address) => onChange({ address })}
      />

      <Input
        label={t('enrollment.pets')}
        value={data.pets}
        onChange={(e) => onChange({ pets: e.target.value })}
        placeholder="e.g. Cat, small dog"
      />

      <Textarea
        label={t('enrollment.notesForBabysitters')}
        value={data.note}
        onChange={(e) => onChange({ note: e.target.value })}
      />

      {/* Consent */}
      <div className="mb-4 mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <Checkbox
          checked={data.consentAccepted}
          onChange={(e) => onChange({ consentAccepted: e.target.checked })}
          label={
            <span>
              {t('enrollment.consentAgree')}{' '}
              <Link to="/terms" target="_blank" className="font-medium text-red-600 underline">{t('enrollment.termsOfService')}</Link>
              {' '}{t('enrollment.consentAnd')}{' '}
              <Link to="/privacy" target="_blank" className="font-medium text-red-600 underline">{t('enrollment.privacyPolicy')}</Link>
            </span>
          }
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={loading || !isValid} className="mb-8 mt-2">
        {loading ? t('enrollment.creatingAccount') : t('enrollment.completeSignUp')}
      </Button>
    </form>
  );
}
