/**
 * Field choices and helpers shared by the classic wizard's StepProfile and
 * CrossAppWelcomePage's gap-filling details step (issue #203) — a component
 * file cannot export them itself (react-refresh/only-export-components).
 */

export const CLASS_LEVELS_TUTOR = [
  'Terminale',
  '1ère',
  '2nde',
  '3ème',
] as const;

export const GENDER_OPTIONS = [
  { value: 'female', labelKey: 'enrollment.genderFemale' },
  { value: 'male', labelKey: 'enrollment.genderMale' },
  { value: 'other', labelKey: 'enrollment.genderOther' },
  { value: 'prefer_not_to_say', labelKey: 'enrollment.genderPreferNot' },
] as const;

export function getAge(dateOfBirth: string): number | null {
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
