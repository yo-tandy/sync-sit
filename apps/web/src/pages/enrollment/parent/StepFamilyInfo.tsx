import { Button, Input, Textarea } from '@/components/ui';
import { AddressAutocomplete } from '@/components/forms/AddressAutocomplete';
import type { ParentFormData } from '../ParentEnrollment';

interface StepFamilyInfoProps {
  data: ParentFormData;
  onChange: (partial: Partial<ParentFormData>) => void;
  onNext: () => void;
  error: string | null;
}

export function StepFamilyInfo({ data, onChange, onNext, error }: StepFamilyInfoProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const isValid = data.familyName && data.firstName && data.address;

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">Your family</h2>
      <p className="mb-6 text-sm text-gray-500">Tell us about your family.</p>

      <Input
        label="Family name *"
        value={data.familyName}
        onChange={(e) => onChange({ familyName: e.target.value })}
        required
      />

      <Input
        label="Your last name (if different)"
        value={data.lastName}
        onChange={(e) => onChange({ lastName: e.target.value })}
        placeholder="Leave blank if same as family name"
      />

      <Input
        label="First name *"
        value={data.firstName}
        onChange={(e) => onChange({ firstName: e.target.value })}
        required
      />

      <AddressAutocomplete
        value={data.address}
        onChange={(address) => onChange({ address })}
      />

      {/* Photo upload placeholder */}
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium">Family photo</p>
          <p className="text-xs text-gray-400">Optional · Max 5 MB</p>
        </div>
      </div>

      <Input
        label="Pets"
        value={data.pets}
        onChange={(e) => onChange({ pets: e.target.value })}
        placeholder="e.g. Cat, small dog"
      />

      <Textarea
        label="Note about your family"
        value={data.note}
        onChange={(e) => onChange({ note: e.target.value })}
        placeholder="Anything babysitters should know..."
      />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={!isValid} className="mb-8 mt-2">
        Continue
      </Button>
    </form>
  );
}
