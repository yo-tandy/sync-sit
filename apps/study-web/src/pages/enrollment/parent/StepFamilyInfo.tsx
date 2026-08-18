import { useTranslation } from 'react-i18next';
import { AddressAutocomplete, Button, Input, Textarea } from '@ejm/shared-ui';
import type { AddressResult } from '@ejm/shared-ui';

// Family info — the submitting step (like the tutor wizard's StepSubjects).
// Consent is NOT collected here: study's structure puts it on the shared
// StepPassword (step 2), which the add-profile jump also passes through in
// consent-only mode — every path consents exactly once.
//
// CONTROLLED (sit's pattern): the orchestrator owns the draft, so walking
// back to the verify step (expired-code rescue) and returning does not lose
// what the parent already typed.

export interface FamilyFormData {
  familyName: string;
  lastName: string;
  firstName: string;
  address: AddressResult | null;
  pets: string;
  note: string;
}

interface StepFamilyInfoProps {
  data: FamilyFormData;
  onChange: (partial: Partial<FamilyFormData>) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepFamilyInfo({ data, onChange, onNext, loading, error }: StepFamilyInfoProps) {
  const { t } = useTranslation();
  const { familyName, lastName, firstName, address, pets, note } = data;

  const isValid = !!familyName && !!firstName && !!address;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.yourFamily')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.yourFamilyDesc')}</p>

      <Input
        label={t('enrollment.familyName')}
        value={familyName}
        onChange={(e) => onChange({ familyName: e.target.value })}
        required
      />

      <Input
        label={t('enrollment.parentLastName')}
        value={lastName}
        onChange={(e) => onChange({ lastName: e.target.value })}
      />

      <Input
        label={t('enrollment.firstName')}
        value={firstName}
        onChange={(e) => onChange({ firstName: e.target.value })}
        required
      />

      {/* The picked AddressResult carries the geocoder postcode/city, which
          the orchestrator forwards to enrollFamily for coverage-area
          matching (issue #167). */}
      <AddressAutocomplete
        label={t('enrollment.addressLabel')}
        value={address}
        onChange={(a) => onChange({ address: a })}
      />

      <Input
        label={t('enrollment.pets')}
        value={pets}
        onChange={(e) => onChange({ pets: e.target.value })}
        placeholder={t('enrollment.petsHint')}
      />

      <Textarea
        label={t('enrollment.notesForTutors')}
        value={note}
        onChange={(e) => onChange({ note: e.target.value })}
      />

      {error && <p className="mb-4 text-sm text-error-600">{error}</p>}

      <Button type="submit" disabled={loading || !isValid} className="mb-8 mt-2">
        {loading ? t('auth.creatingAccount') : t('enrollment.completeSignup')}
      </Button>
    </form>
  );
}
