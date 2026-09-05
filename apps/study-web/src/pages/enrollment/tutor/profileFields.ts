/**
 * Field choices and helpers shared by the classic wizard's StepProfile and
 * CrossAppWelcomePage's gap-filling details step (issue #203) — a component
 * file cannot export them itself (react-refresh/only-export-components).
 *
 * CLASS_LEVELS_TUTOR/GENDER_OPTIONS re-export the shared-core constants
 * (issue #435 milestone, PR1) — this used to be a hand-maintained copy,
 * byte-for-byte identical to sit's own inline copy in its babysitter
 * StepProfile.tsx. Kept under their original names here so every existing
 * import (`./StepProfile`, `./TutorEnrollment`, the public
 * `CrossAppWelcomePage`) keeps working unchanged.
 */
export { LYCEE_CLASS_LEVELS as CLASS_LEVELS_TUTOR, GENDER_OPTIONS } from '@ejm/shared-core';

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
