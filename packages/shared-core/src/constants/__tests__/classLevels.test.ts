import { describe, it, expect } from 'vitest';
import { LYCEE_CLASS_LEVELS, GENDER_OPTIONS } from '../classLevels.js';

describe('LYCEE_CLASS_LEVELS', () => {
  it('is the shared French lycée class-level list, in order', () => {
    // Pinned exactly — sit's babysitter StepProfile.tsx and study's tutor
    // profileFields.ts both dedupe onto this list (issue #435 milestone,
    // PR1); a change here changes both apps' enrollment dropdown.
    expect(LYCEE_CLASS_LEVELS).toEqual(['Terminale', '1ère', '2nde', '3ème']);
  });
});

describe('GENDER_OPTIONS', () => {
  it('is the shared gender option list, in order, with stable labelKeys', () => {
    expect(GENDER_OPTIONS).toEqual([
      { value: 'female', labelKey: 'enrollment.genderFemale' },
      { value: 'male', labelKey: 'enrollment.genderMale' },
      { value: 'other', labelKey: 'enrollment.genderOther' },
      { value: 'prefer_not_to_say', labelKey: 'enrollment.genderPreferNot' },
    ]);
  });
});
