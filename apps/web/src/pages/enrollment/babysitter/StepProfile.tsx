import { useRef, useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { LanguagePicker } from '@/components/forms/LanguagePicker';
import type { BabysitterFormData } from '../BabysitterEnrollment';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

interface StepProfileProps {
  data: BabysitterFormData;
  onChange: (partial: Partial<BabysitterFormData>) => void;
  onNext: () => void;
  error: string | null;
}

function getAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const today = new Date();
  const dob = new Date(dateOfBirth);
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

const GENDER_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not' },
];


export function StepProfile({ data, onChange, onNext, error }: StepProfileProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const handlePhotoSelect = (file: File) => {
    setPhotoError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError('Please select a JPEG, PNG, or WebP image');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPhotoError('Photo must be under 5 MB');
      return;
    }
    onChange({ photoFile: file });
    const reader = new FileReader();
    reader.onload = (e) => setPhotoPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoSelect(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setPhotoError(null);
    onChange({ photoFile: undefined });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const age = getAge(data.dateOfBirth);
  const ageValid = age !== null && age >= 15 && age < 19;
  const showAgeError = data.dateOfBirth && !ageValid;

  const isValid =
    data.firstName &&
    data.lastName &&
    data.dateOfBirth &&
    ageValid &&
    data.classLevel &&
    data.languages.length > 0;

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">About you</h2>
      <p className="mb-6 text-sm text-gray-500">
        Tell families a bit about yourself.
      </p>

      {/* Photo upload */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="mb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-gray-400 hover:bg-gray-100"
        >
          {photoPreview ? (
            <img src={photoPreview} alt="Profile" className="h-full w-full object-cover" />
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </button>
        <div>
          {photoPreview ? (
            <button
              type="button"
              onClick={handleRemovePhoto}
              className="text-sm font-medium text-red-600 hover:text-red-700"
            >
              Remove photo
            </button>
          ) : (
            <p className="text-sm font-medium">Add a photo</p>
          )}
          <p className="text-xs text-gray-400">Optional · Max 5 MB</p>
          {photoError && <p className="text-xs text-red-600">{photoError}</p>}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label="First name *"
            value={data.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            required
          />
        </div>
        <div className="flex-1">
          <Input
            label="Last name *"
            value={data.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <Input
            label="Date of birth *"
            type="date"
            value={data.dateOfBirth}
            onChange={(e) => onChange({ dateOfBirth: e.target.value })}
            tooltip="We collect your date of birth so families can see the age of their potential babysitter."
            error={showAgeError ? 'You must be between 15 and 18 years old' : undefined}
            required
          />
        </div>
        <div className="min-w-0">
          <Select
            label="Class *"
            value={data.classLevel}
            onChange={(e) => onChange({ classLevel: e.target.value })}
            placeholder="Select class"
            options={[
              { value: 'Terminale', label: 'Terminale' },
              { value: '1ère', label: '1ère' },
              { value: '2nde', label: '2nde' },
              { value: '3ème', label: '3ème' },
            ]}
            required
          />
        </div>
      </div>

      {/* Gender */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Gender
        </label>
        <div className="flex gap-2">
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                onChange({ gender: data.gender === opt.value ? undefined : opt.value })
              }
              className={`flex-1 rounded-lg border-[1.5px] px-2 py-2 text-sm font-medium transition-colors ${
                data.gender === opt.value
                  ? 'border-red-600 bg-red-50 text-red-600'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Languages */}
      <LanguagePicker
        selected={data.languages}
        onChange={(languages) => onChange({ languages })}
      />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={!isValid} className="mt-4">
        Continue
      </Button>
    </form>
  );
}
