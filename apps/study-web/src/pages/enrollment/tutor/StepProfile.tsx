import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  '1ere',
  '2nde',
  '3e',
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
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.firstName')}</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
            required
          />
        </div>
        <div className="flex-1">
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.lastName')}</label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.dateOfBirth')}</label>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className={`h-12 w-full rounded-lg border-[1.5px] bg-white px-4 text-base outline-none transition-colors focus:border-red-600 ${showAgeError ? 'border-red-600' : 'border-gray-300'}`}
            required
          />
          {showAgeError && (
            <p className="mt-1 text-xs text-red-600">{t('enrollment.ageError')}</p>
          )}
        </div>
        <div className="min-w-0">
          <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.classLabel')}</label>
          <select
            value={classLevel}
            onChange={(e) => setClassLevel(e.target.value)}
            className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base outline-none transition-colors focus:border-red-600"
            required
          >
            <option value="">{t('enrollment.selectClass')}</option>
            {CLASS_LEVELS_TUTOR.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
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

      <button
        type="submit"
        disabled={!isValid}
        className="mt-4 flex h-[52px] w-full items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90 disabled:opacity-50"
      >
        {t('common.continue')}
      </button>
    </form>
  );
}
