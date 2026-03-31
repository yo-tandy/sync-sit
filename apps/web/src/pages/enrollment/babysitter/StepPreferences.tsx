import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Input, Textarea, Chip, Checkbox } from '@/components/ui';
import { AddressAutocomplete, type AddressResult } from '@/components/forms/AddressAutocomplete';
import { ARRONDISSEMENTS, NEARBY_TOWNS } from '@ejm/shared';
import type { BabysitterFormData } from '../BabysitterEnrollment';

interface StepPreferencesProps {
  data: BabysitterFormData;
  onChange: (partial: Partial<BabysitterFormData>) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}

export function StepPreferences({ data, onChange, onNext, loading, error }: StepPreferencesProps) {
  const { t } = useTranslation();
  const toggleArea = (area: string) => {
    const current = data.arrondissements || [];
    if (current.includes(area)) {
      onChange({ arrondissements: current.filter((a) => a !== area) });
    } else {
      onChange({ arrondissements: [...current, area] });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const hasContact = !!(data.contactEmail || data.contactPhone);
  const hasArea =
    data.areaMode === 'distance'
      ? !!data.areaAddress
      : (data.arrondissements?.length ?? 0) > 0;

  const isValid = hasContact && hasArea;

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">Preferences</h2>
      <p className="mb-6 text-sm text-gray-500">
        Set your babysitting preferences and contact info.
      </p>

      {/* Age range + max kids */}
      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label="Kids age min *"
            type="number"
            value={data.kidAgeMin}
            onChange={(e) => onChange({ kidAgeMin: parseInt(e.target.value) || 0 })}
            min={0}
            max={18}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Kids age max *"
            type="number"
            value={data.kidAgeMax}
            onChange={(e) => onChange({ kidAgeMax: parseInt(e.target.value) || 0 })}
            min={0}
            max={18}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label="Max kids *"
            type="number"
            value={data.maxKids}
            onChange={(e) => onChange({ maxKids: parseInt(e.target.value) || 1 })}
            min={1}
            max={10}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Rate (€/hr) *"
            type="number"
            value={data.hourlyRate}
            onChange={(e) => onChange({ hourlyRate: parseFloat(e.target.value) || 0 })}
            min={0}
          />
        </div>
      </div>

      <Textarea
        label="About me & experience"
        value={data.aboutMe}
        onChange={(e) => onChange({ aboutMe: e.target.value })}
        placeholder="Tell families about yourself..."
      />

      <hr className="my-5 border-gray-200" />

      {/* Contact */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Contact (at least one) *
        </label>
        <Input
          placeholder="Email"
          type="email"
          value={data.contactEmail}
          onChange={(e) => onChange({ contactEmail: e.target.value })}
        />
        <Input
          placeholder="Phone"
          type="tel"
          value={data.contactPhone}
          onChange={(e) => onChange({ contactPhone: e.target.value })}
        />
        {!hasContact && (
          <p className="text-sm text-red-600">Provide at least one contact method</p>
        )}
      </div>

      <hr className="my-5 border-gray-200" />

      {/* Area */}
      <div className="mb-5">
        <label className="mb-4 block text-sm font-medium text-gray-700">
          Area I can babysit in *
        </label>

        {/* Toggle */}
        <div className="mb-4 flex rounded-lg bg-gray-100 p-[3px]">
          <button
            type="button"
            onClick={() => onChange({ areaMode: 'arrondissement' })}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
              data.areaMode === 'arrondissement'
                ? 'bg-white text-gray-950 shadow-sm'
                : 'text-gray-500'
            }`}
          >
            By area
          </button>
          <button
            type="button"
            onClick={() => onChange({ areaMode: 'distance' })}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
              data.areaMode === 'distance'
                ? 'bg-white text-gray-950 shadow-sm'
                : 'text-gray-500'
            }`}
          >
            By distance
          </button>
        </div>

        {data.areaMode === 'arrondissement' ? (
          <div>
            <p className="mb-2 text-xs text-gray-400">Arrondissements</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {ARRONDISSEMENTS.map((arr) => (
                <Chip
                  key={arr}
                  selected={data.arrondissements?.includes(arr)}
                  onClick={() => toggleArea(arr)}
                >
                  {arr}
                </Chip>
              ))}
            </div>
            <p className="mb-2 text-xs text-gray-400">Nearby towns</p>
            <div className="flex flex-wrap gap-2">
              {NEARBY_TOWNS.map((town) => (
                <Chip
                  key={town}
                  selected={data.arrondissements?.includes(town)}
                  onClick={() => toggleArea(town)}
                >
                  {town}
                </Chip>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <AddressAutocomplete
              label="Your address"
              value={
                data.areaAddress
                  ? {
                      fullAddress: data.areaAddress,
                      street: '',
                      city: '',
                      postcode: '',
                      lat: data.areaLatLng?.lat || 0,
                      lng: data.areaLatLng?.lng || 0,
                    }
                  : null
              }
              onChange={(addr: AddressResult | null) =>
                onChange({
                  areaAddress: addr?.fullAddress || '',
                  areaLatLng: addr ? { lat: addr.lat, lng: addr.lng } : undefined,
                })
              }
            />
            <Input
              label="Max distance (km)"
              type="number"
              value={data.areaRadiusKm}
              onChange={(e) => onChange({ areaRadiusKm: parseFloat(e.target.value) || 1 })}
              min={1}
              max={20}
            />
          </div>
        )}
      </div>

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

      <Button type="submit" disabled={loading || !isValid || !data.consentAccepted} className="mb-8 mt-4">
        {loading ? t('enrollment.creatingAccount') : t('enrollment.completeSignUp')}
      </Button>
    </form>
  );
}
