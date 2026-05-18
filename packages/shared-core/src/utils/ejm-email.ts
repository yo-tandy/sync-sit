import { EJM_DOMAIN, getValidGraduationYears } from '../constants/config.js';

export interface EjmEmailValidation {
  valid: boolean;
  error?: string;
  graduationYear?: number;
}

/**
 * Validate an EJM email address.
 * - Must be @ejm.org domain
 * - Last 2 characters of local part must be a valid graduation year
 */
export function validateEjmEmail(
  email: string,
  now: Date = new Date()
): EjmEmailValidation {
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

  const validYears = getValidGraduationYears(now);

  if (!validYears.includes(yearNum)) {
    return {
      valid: false,
      error: `Graduation year ${yearStr} is not currently valid. Accepted: ${validYears.join(', ')}`,
    };
  }

  return { valid: true, graduationYear: yearNum };
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
