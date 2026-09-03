import { EJM_DOMAIN, getValidGraduationYears } from '../constants/config.js';

export interface EjmEmailValidation {
  valid: boolean;
  error?: string;
  graduationYear?: number;
}

/**
 * Domain and graduation-year-FORMAT checks shared by both exports below:
 * must be an @ejm.org address, and the local part's last 2 characters must
 * parse as a number. Says nothing about whether that year is a currently
 * enrollable cohort — callers decide whether that window applies.
 */
function parseEjmEmailFormat(email: string): EjmEmailValidation {
  const normalized = email.trim().toLowerCase();

  // Check domain
  const parts = normalized.split('@');
  if (parts.length !== 2 || parts[1] !== EJM_DOMAIN) {
    return { valid: false, error: `Email must be an @${EJM_DOMAIN} address` };
  }

  const localPart = parts[0];
  if (localPart.length < 3) {
    return { valid: false, error: 'Invalid EJM email format' };
  }

  // Extract last 2 digits
  const yearStr = localPart.slice(-2);
  const yearNum = parseInt(yearStr, 10);

  if (isNaN(yearNum)) {
    return {
      valid: false,
      error: 'Email must end with your graduation year (e.g., name28@ejm.org)',
    };
  }

  return { valid: true, graduationYear: yearNum };
}

/**
 * Validate an EJM email address for SELF-enrollment.
 * - Must be @ejm.org domain
 * - Last 2 characters of local part must be a valid graduation year
 * - That year must fall within the current 4-year enrollable window
 *   (`getValidGraduationYears`) -- the person is claiming to be a CURRENT or
 *   soon-to-be EJM student enrolling themselves.
 *
 * Do not use this for a supervised kid invite: see
 * `validateEjmEmailForKidInvite`, which drops the window deliberately.
 */
export function validateEjmEmail(
  email: string,
  now: Date = new Date()
): EjmEmailValidation {
  const parsed = parseEjmEmailFormat(email);
  if (!parsed.valid || parsed.graduationYear === undefined) return parsed;

  const validYears = getValidGraduationYears(now);
  if (!validYears.includes(parsed.graduationYear)) {
    const yearStr = String(parsed.graduationYear).padStart(2, '0');
    return {
      valid: false,
      error: `Graduation year ${yearStr} is not currently valid. Accepted: ${validYears.join(', ')}`,
    };
  }

  return parsed;
}

/**
 * Validate an EJM email address for a SUPERVISED KID INVITE (issue #430).
 *
 * Domain and graduation-year format only -- deliberately NOT the current
 * 4-year window `validateEjmEmail` enforces for self-enrollment. A supervised
 * account exists precisely to admit a kid who is nowhere near that window: a
 * 2nd grader's email might end in a graduation year a decade out, and
 * rejecting it on sight would defeat the whole point of supervision. The
 * parent still supplies the kid's real date of birth, and there is
 * deliberately no DOB/grad-year consistency gate on this path either
 * (supervision replaces gating, not just the year window) --
 * `createKidInvite.ts` and `tests/integration/guardian/create-kid-invite.test.ts`
 * both say so.
 *
 * Still requires a real @ejm.org address and a parseable graduation year: the
 * domain proves EJM affiliation, and the two digits are load-bearing
 * elsewhere (e.g. cross-app enrollment reads them off the stored email).
 */
export function validateEjmEmailForKidInvite(email: string): EjmEmailValidation {
  return parseEjmEmailFormat(email);
}

/**
 * Check if a user's age is at least the minimum babysitter age.
 */
export function isOldEnough(
  dateOfBirth: Date,
  minAge: number = 15,
  now: Date = new Date()
): boolean {
  const age = now.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = now.getMonth() - dateOfBirth.getMonth();
  const dayDiff = now.getDate() - dateOfBirth.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    return age - 1 >= minAge;
  }
  return age >= minAge;
}
