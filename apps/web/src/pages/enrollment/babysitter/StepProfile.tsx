import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Button, Input, Select } from '@/components/ui';

interface StepProfileProps {
  uid: string;
  onNext: () => void;
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
  { value: 'female', labelKey: 'enrollment.genderFemale' },
  { value: 'male', labelKey: 'enrollment.genderMale' },
  { value: 'other', labelKey: 'enrollment.genderOther' },
  { value: 'prefer_not_to_say', labelKey: 'enrollment.genderPreferNot' },
];

export function StepProfile({ uid, onNext }: StepProfileProps) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [gender, setGender] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const age = getAge(dateOfBirth);
  const ageValid = age !== null && age >= 15 && age < 19;
  const showAgeError = dateOfBirth && !ageValid;

  const isValid = firstName && lastName && dateOfBirth && ageValid && classLevel;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !uid) return;
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        firstName,
        lastName,
        dateOfBirth,
        classLevel,
        gender: gender || null,
        updatedAt: serverTimestamp(),
      });
      onNext();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">{t('enrollment.welcomeTitle1')}<br />{t('enrollment.welcomeTitle2')}</h2>
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
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('enrollment.gender')}</label>
        <div className="flex gap-2">
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

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={!isValid || saving} className="mt-4">
        {saving ? t('common.saving') : t('common.continue')}
      </Button>
    </form>
  );
}
