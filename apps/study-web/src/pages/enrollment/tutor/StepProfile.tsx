import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Select } from '@ejm/shared-ui';

export interface ProfileData {
  // Identity is absent when it is already on file (issue #144) — the server
  // keeps the stored, set-once values.
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  classLevel: string;
  gender?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/** Root identity already carried by the signed-in user's doc (cross-app). */
export interface IdentityOnFile {
  firstName: string;
  lastName: string;
  /** Firestore Timestamp on study-created accounts, "YYYY-MM-DD" string on sit-created ones. */
  dateOfBirth: unknown;
}

interface StepProfileProps {
  onNext: (data: ProfileData) => void;
  /** Previously-entered values, restored on back-navigation. */
  initial?: ProfileData | null;
  /** A submit-time server rejection carried back from the subjects step —
   * the field it names usually lives HERE. */
  serverError?: string | null;
  identityOnFile?: IdentityOnFile | null;
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

/**
 * Display form of an on-file DOB: sit-created accounts store a "YYYY-MM-DD"
 * string, study-created ones a Firestore Timestamp (mirrors AccountPage).
 */
function formatDob(dob: unknown): string {
  if (typeof dob === 'string') return dob;
  if (
    typeof dob === 'object' &&
    dob !== null &&
    'toDate' in dob &&
    typeof (dob as { toDate: unknown }).toDate === 'function'
  ) {
    return (dob as { toDate: () => Date }).toDate().toLocaleDateString();
  }
  return '';
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

export function StepProfile({ onNext, initial = null, serverError = null, identityOnFile = null }: StepProfileProps) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(initial?.dateOfBirth ?? '');
  const [classLevel, setClassLevel] = useState(initial?.classLevel ?? '');
  const [gender, setGender] = useState<string | undefined>(initial?.gender);
  // Contact moved here from the removed prefs step (issue #143): families see
  // it on the tutor card after accepting a request, so the callable requires
  // at least one field.
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');

  const age = getAge(dateOfBirth);
  // The client age gate only applies when a DOB is being ENTERED. With
  // identity on file the account already passed sit's identical 15-19 gate,
  // and the server re-runs its gate against the stored DOB anyway.
  const ageValid = age !== null && age >= 15 && age < 19;
  const showAgeError = dateOfBirth && !ageValid;
  // Mirror the server's zod .email() strictness: the native input accepts
  // 'x@y', which the callable rejects AFTER this step is gone — validate
  // here so the rejection can't strand the user on the subjects step.
  const emailFormatOk =
    !contactEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail.trim());
  const hasContact = contactEmail.trim() || contactPhone.trim();
  const identityValid = identityOnFile
    ? true
    : firstName && lastName && dateOfBirth && ageValid;
  // emailFormatOk gates UNCONDITIONALLY (true when the email is empty): with
  // a phone also present, a malformed email must still block — otherwise it
  // rides into the payload and the server rejects on the subjects step.
  const isValid = identityValid && classLevel && hasContact && emailFormatOk;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onNext({
      // Omit the identity fields when they are on file (issue #144): the
      // server keeps the stored, set-once values.
      ...(identityOnFile ? {} : { firstName, lastName, dateOfBirth }),
      classLevel,
      gender,
      contactEmail: contactEmail.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">
        {t('enrollment.welcomeTitle1')}<br />{t('enrollment.welcomeTitle2')}
      </h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.welcomeSubtitle')}</p>

      {identityOnFile ? (
        <div className="mb-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p>
            {t('enrollment.identityOnFile', {
              name: `${identityOnFile.firstName} ${identityOnFile.lastName}`,
            })}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t('enrollment.dateOfBirth')}: {formatDob(identityOnFile.dateOfBirth)}
          </p>
        </div>
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
              error={showAgeError ? t('enrollment.ageError') : undefined}
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
                  ? 'border-brand-600 bg-brand-50 text-brand-600'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <hr className="my-5 border-gray-200" />

      {/* Contact */}
      <p className="mb-1 text-sm font-semibold text-gray-700">{t('enrollment.contactSection')}</p>
      <p className="mb-3 text-xs text-gray-500">{t('enrollment.contactHint')}</p>
      <Input
        label={t('enrollment.contactEmail')}
        type="email"
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
        error={contactEmail.trim() && !emailFormatOk ? t('enrollment.contactEmailInvalid') : undefined}
      />
      <Input
        label={t('enrollment.contactPhone')}
        type="tel"
        value={contactPhone}
        onChange={(e) => setContactPhone(e.target.value)}
      />

      {serverError && <p className="mb-4 text-sm text-brand-600">{serverError}</p>}

      <Button type="submit" disabled={!isValid}>
        {t('common.continue')}
      </Button>
    </form>
  );
}
