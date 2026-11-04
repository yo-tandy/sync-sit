import { useTranslation } from 'react-i18next';
import type { Address } from '@ejm/shared-core';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Textarea } from '../components/Textarea.js';
import { AddressAutocomplete } from '../forms/AddressAutocomplete.js';

/**
 * The family draft the orchestrator owns. CONTROLLED on purpose: the
 * expired-code rescue walks back to the verify step and returns, and what
 * the parent already typed must survive that round trip (both apps'
 * orchestrators already keep the draft in their own state).
 */
export interface FamilyFormData {
  familyName: string;
  /** Optional — empty means "same as the family name" (the backend falls back). */
  lastName: string;
  firstName: string;
  address: Address | null;
  pets: string;
  note: string;
}

interface StepFamilyInfoProps {
  data: FamilyFormData;
  onChange: (partial: Partial<FamilyFormData>) => void;
  /** The submitting step: the orchestrator calls `enrollFamily` here. */
  onNext: () => void;
  loading: boolean;
  error: string | null;
  /**
   * The free-text notes label, already translated by the host: sit says
   * "Notes for babysitters", study "Notes for tutors". The only copy that
   * differs between the two apps' family steps, so it is a prop rather than
   * a key the component would have to guess.
   */
  noteLabel: string;
}

/**
 * Family-info step of the shared parent wizard (issue #440, PR1) — the
 * submitting step. Family name, the parent's first name and a picked address
 * are required; the geocoder `postcode`/`city` on the picked `Address` ride
 * along for coverage-area matching (issue #167) — the orchestrator forwards
 * them to `enrollFamily`.
 *
 * Consent is NOT collected here: the shared wizard puts it on `StepPassword`
 * (the student and study-parent convention), so every path — fresh signup
 * and the consent-only add-profile entry — consents exactly once.
 */
export function StepFamilyInfo({ data, onChange, onNext, loading, error, noteLabel }: StepFamilyInfoProps) {
  const { t } = useTranslation();
  const { familyName, lastName, firstName, address, pets, note } = data;

  const isValid = !!familyName.trim() && !!firstName.trim() && !!address;

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

      <AddressAutocomplete
        label={t('enrollment.familyAddressLabel')}
        value={address}
        onChange={(a) => onChange({ address: a })}
      />

      <Input
        label={t('enrollment.pets')}
        value={pets}
        onChange={(e) => onChange({ pets: e.target.value })}
        placeholder={t('enrollment.petsHint')}
      />

      <Textarea label={noteLabel} value={note} onChange={(e) => onChange({ note: e.target.value })} />

      {error && <p className="mb-4 text-sm text-error-600">{error}</p>}

      <Button type="submit" disabled={loading || !isValid} className="mb-8 mt-2">
        {loading ? t('auth.creatingAccount') : t('enrollment.completeSignup')}
      </Button>
    </form>
  );
}
