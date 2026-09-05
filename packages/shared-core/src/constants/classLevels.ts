/**
 * Shared student-identity option lists (issue #435 milestone, PR1).
 *
 * `classLevel` and `gender` were promoted from being duplicated, per-role
 * fields (`profiles.babysitter.classLevel/gender` in sit,
 * `profiles.tutor.classLevel/gender` in study — copy-pasted, byte-for-byte
 * identical option lists) to root `User` fields. This is the single shared
 * source both apps' enrollment steps import from instead of each keeping its
 * own hardcoded copy.
 *
 * Named `LYCEE_CLASS_LEVELS` (not `CLASS_LEVELS`) to avoid colliding with
 * `@ejm/study-core`'s unrelated `CLASS_LEVELS` constant (the school levels a
 * tutor can teach, e.g. for subject offerings) — a different concept that
 * happens to share a name in a different package.
 */
export const LYCEE_CLASS_LEVELS = ['Terminale', '1ère', '2nde', '3ème'] as const;

export type LyceeClassLevel = (typeof LYCEE_CLASS_LEVELS)[number];

export type Gender = 'female' | 'male' | 'other' | 'prefer_not_to_say';

export interface GenderOption {
  value: Gender;
  labelKey: string;
}

export const GENDER_OPTIONS: readonly GenderOption[] = [
  { value: 'female', labelKey: 'enrollment.genderFemale' },
  { value: 'male', labelKey: 'enrollment.genderMale' },
  { value: 'other', labelKey: 'enrollment.genderOther' },
  { value: 'prefer_not_to_say', labelKey: 'enrollment.genderPreferNot' },
] as const;
