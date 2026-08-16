import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { validateEjmEmail, checkEnrollmentAge } from '@ejm/shared-core';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Select } from '@/components/ui';

interface StepProfileProps {
  uid: string;
  /** The signed-in user's EJM email — supplies the grad-year signal. */
  email: string;
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

/**
 * Client-only UX for the enrollment age gate (governance design): sit's
 * enrollBabysitter never sees the DOB, so the server truth is the
 * searchBabysitters backstop — this just surfaces the friendly message at the
 * moment the DOB is entered. Dual signal: entered DOB vs the grad year in the
 * signed-in EJM email; when the email carries no parseable grad year we fall
 * back to the plain 15–18 range check.
 */
function ageGateErrorKey(dateOfBirth: string, age: number | null, email: string): string | null {
  if (!dateOfBirth || age === null) return null;
  const emailCheck = validateEjmEmail(email);
  if (emailCheck.valid && emailCheck.graduationYear !== undefined) {
    const verdict = checkEnrollmentAge({
      dateOfBirth: new Date(dateOfBirth),
      graduationYear: emailCheck.graduationYear,
    });
    if (verdict === 'under_15') return 'enrollment.age.under15';
    if (verdict === 'age_mismatch') return 'enrollment.age.mismatch';
    return null;
  }
  return age >= 15 && age < 19 ? null : 'enrollment.ageError';
}

const GENDER_OPTIONS = [
  { value: 'female', labelKey: 'enrollment.genderFemale' },
  { value: 'male', labelKey: 'enrollment.genderMale' },
  { value: 'other', labelKey: 'enrollment.genderOther' },
  { value: 'prefer_not_to_say', labelKey: 'enrollment.genderPreferNot' },
];

export function StepProfile({ uid, email, onNext }: StepProfileProps) {
  const { t } = useTranslation();
  const userDoc = useAuthStore((s) => s.userDoc);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [gender, setGender] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Root identity is set-once (issue #144): a cross-app user (e.g. an existing
  // study tutor) already carries firstName/lastName/dateOfBirth, and the rules
  // deny any client write that would change them. Only ABSENT fields may be
  // collected and written here. When all three are on file the wizard normally
  // routes past this step; a direct URL/remount shows a read-only line instead
  // of dead inputs.
  const hasFirstName = !!userDoc?.firstName;
  const hasLastName = !!userDoc?.lastName;
  const hasDateOfBirth = !!userDoc?.dateOfBirth;
  const identityOnFile = hasFirstName && hasLastName && hasDateOfBirth;

  const age = getAge(dateOfBirth);
  const ageErrorKey = ageGateErrorKey(dateOfBirth, age, email);
  const ageValid = age !== null && ageErrorKey === null;

  const isValid = (hasFirstName || firstName)
    && (hasLastName || lastName)
    && (hasDateOfBirth || (dateOfBirth && ageValid))
    && classLevel;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !uid) return;
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        ...(hasFirstName ? {} : { firstName }),
        ...(hasLastName ? {} : { lastName }),
        ...(hasDateOfBirth ? {} : { dateOfBirth }),
        'profiles.babysitter.classLevel': classLevel,
        'profiles.babysitter.gender': gender || null,
        updatedAt: serverTimestamp(),
      });
      onNext();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">{t('enrollment.welcomeTitle1')}<br />{t('enrollment.welcomeTitle2')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.welcomeSubtitle')}</p>

      {identityOnFile ? (
        <p className="mb-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {t('enrollment.identityOnFile', {
            name: `${userDoc?.firstName} ${userDoc?.lastName}`,
          })}
        </p>
      ) : (
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
      )}

      <div className="grid grid-cols-2 gap-3">
        {!identityOnFile && (
          <div className="min-w-0">
            <Input
              label={t('enrollment.dateOfBirth')}
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              error={ageErrorKey ? t(ageErrorKey) : undefined}
              required
            />
          </div>
        )}
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
                  ? 'border-brand-600 bg-brand-50 text-brand-600'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

      <Button type="submit" disabled={!isValid || saving} className="mt-4">
        {saving ? t('common.saving') : t('common.continue')}
      </Button>
    </form>
  );
}
