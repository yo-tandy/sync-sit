import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  validateEjmEmail,
  checkEnrollmentAge,
  LYCEE_CLASS_LEVELS,
  GENDER_OPTIONS,
  type Gender,
} from '@ejm/shared-core';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Select } from '../components/Select.js';

export interface BasicInfoData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  classLevel: string;
  gender: Gender;
}

interface StepBasicInfoProps {
  onNext: (data: BasicInfoData) => void;
  /** Previously-entered values, restored on back-navigation. */
  initial?: BasicInfoData | null;
  /**
   * The just-verified EJM email (from `StepEmail`/`StepVerify`) -- feeds the
   * client-side age gate the same way sit/study's own per-role `StepProfile`
   * does: a dual signal, entered DOB vs. the graduation year encoded in the
   * email, falling back to a plain 15-18 range check when no year parses.
   */
  ejemEmail: string;
  /** A submit-time server rejection carried back from a later step. */
  serverError?: string | null;
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
 * Mirrors sit's `StepProfile` age gate verbatim (client-only UX; the server
 * callable that eventually consumes this data re-runs its own check). Dual
 * signal: the entered DOB against the graduation year in the verified EJM
 * email, falling back to a plain 15-18 range check when no year parses.
 */
function ageGateErrorKey(dateOfBirth: string, age: number | null, ejemEmail: string): string | null {
  if (!dateOfBirth || age === null) return null;
  const emailCheck = validateEjmEmail(ejemEmail);
  if (emailCheck.valid && emailCheck.graduationYear !== undefined) {
    const verdict = checkEnrollmentAge({
      dateOfBirth: new Date(dateOfBirth),
      graduationYear: emailCheck.graduationYear,
    });
    if (verdict === 'under_15') return 'unifiedEnrollment.ageUnder15';
    if (verdict === 'age_mismatch') return 'unifiedEnrollment.ageMismatch';
    return null;
  }
  return age >= 15 && age < 19 ? null : 'unifiedEnrollment.ageError';
}

/**
 * Basic-identity step of the unified enrollment flow (issue #435 milestone,
 * PR3, step 4b "basic info"): firstName/lastName/DOB, classLevel and
 * gender. Generalizes sit's/study's own per-role `StepProfile` first
 * section -- same fields, same validation -- but ALL FIVE are mandatory
 * here (unlike the per-role versions, where gender is optional): the
 * unified flow collects identity once, before the user has even chosen
 * sit or study, so there is no later per-role screen to fill gender in on.
 *
 * Presentational only: owns its own field state and the local validation
 * needed to enable the button, calls `onNext` with the finished payload.
 * No callables, no routing -- the orchestrator (PR4) decides what happens
 * next.
 */
export function StepBasicInfo({ onNext, initial = null, ejemEmail, serverError = null }: StepBasicInfoProps) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(initial?.dateOfBirth ?? '');
  const [classLevel, setClassLevel] = useState(initial?.classLevel ?? '');
  const [gender, setGender] = useState<Gender | undefined>(initial?.gender);

  const age = getAge(dateOfBirth);
  const ageErrorKey = ageGateErrorKey(dateOfBirth, age, ejemEmail);
  const ageValid = age !== null && ageErrorKey === null;

  const isValid = Boolean(firstName.trim() && lastName.trim() && dateOfBirth && ageValid && classLevel && gender);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !gender) return;
    onNext({ firstName: firstName.trim(), lastName: lastName.trim(), dateOfBirth, classLevel, gender });
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">{t('unifiedEnrollment.basicInfoTitle')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('unifiedEnrollment.basicInfoSubtitle')}</p>

      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            label={t('unifiedEnrollment.firstName')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="flex-1">
          <Input
            label={t('unifiedEnrollment.lastName')}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <Input
            label={t('unifiedEnrollment.dateOfBirth')}
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            error={ageErrorKey ? t(ageErrorKey) : undefined}
            required
          />
        </div>
        <div className="min-w-0">
          <Select
            label={t('unifiedEnrollment.classLabel')}
            value={classLevel}
            onChange={(e) => setClassLevel(e.target.value)}
            placeholder={t('unifiedEnrollment.selectClass')}
            options={LYCEE_CLASS_LEVELS.map((level) => ({ value: level, label: level }))}
            required
          />
        </div>
      </div>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t('unifiedEnrollment.gender')}</label>
        <div className="flex flex-wrap gap-2">
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={gender === opt.value}
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

      {serverError && <p className="mb-4 text-sm text-error-600">{serverError}</p>}

      <Button type="submit" disabled={!isValid}>
        {t('common.continue')}
      </Button>
    </form>
  );
}
