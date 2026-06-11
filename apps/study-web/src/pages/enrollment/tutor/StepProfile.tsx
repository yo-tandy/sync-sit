import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Select } from '@ejm/shared-ui';

export interface ProfileData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  classLevel: string;
  gender?: string;
}

interface StepProfileProps {
  onNext: (data: ProfileData) => void;
}

const CLASS_LEVELS_TUTOR = [
  'Terminale',
  '1ère',
  '2nde',
  '3ème',
] as const;

const GENDER_OPTIONS = [
  { value: 'female', labelKey: 'enrollment.genderFemale' },
  { value: 'male', labelKey: 'enrollment.genderMale' },
  { value: 'other', labelKey: 'enrollment.genderOther' },
  { value: 'prefer_not_to_say', labelKey: 'enrollment.genderPreferNot' },
] as const;

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

export function StepProfile({ onNext }: StepProfileProps) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [gender, setGender] = useState<string | undefined>(undefined);

  const age = getAge(dateOfBirth);
  const ageValid = age !== null && age >= 15 && age < 19;
  const showAgeError = dateOfBirth && !ageValid;
  const isValid = firstName && lastName && dateOfBirth && ageValid && classLevel;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onNext({ firstName, lastName, dateOfBirth, classLevel, gender });
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">
        {t('enrollment.welcomeTitle1')}<br />{t('enrollment.welcomeTitle2')}
      </h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.welcomeSubtitle')}</p>

      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label={t('enrollment.firstName')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="flex-1">
          <Input
            label={t('enrollment.lastName')}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <Input
            label={t('enrollment.dateOfBirth')}
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            error={showAgeError ? t('enrollment.ageError') : undefined}
            required
          />
        </div>
        <div className="min-w-0">
          <Select
            label={t('enrollment.classLabel')}
            value={classLevel}
            onChange={(e) => setClassLevel(e.target.value)}
            placeholder={t('enrollment.selectClass')}
            options={CLASS_LEVELS_TUTOR.map((level) => ({ value: level, label: level }))}
            required
          />
        </div>
      </div>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.gender')}</label>
        <div className="flex flex-wrap gap-2">
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setGender(gender === opt.value ? undefined : opt.value)}
              className={`flex-1 rounded-lg border-[1.5px] px-2 py-2 text-sm font-medium transition-colors ${
                gender === opt.value
                  ? 'border-red-600 bg-red-50 text-red-600'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={!isValid}>
        {t('common.continue')}
      </Button>
    </form>
  );
}
