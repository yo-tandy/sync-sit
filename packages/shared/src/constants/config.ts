/** EJM email domain */
export const EJM_DOMAIN = 'ejm.org';

/** Minimum babysitter age */
export const MIN_BABYSITTER_AGE = 15;

/** Max photo upload size in bytes (5 MB) */
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

/** Invite link expiry in milliseconds (1 hour) */
export const INVITE_LINK_EXPIRY_MS = 60 * 60 * 1000;

/** Verification code length */
export const VERIFICATION_CODE_LENGTH = 6;

/** Verification code cooldown in seconds */
export const VERIFICATION_CODE_COOLDOWN_S = 60;

/** Past/rejected appointment visibility in days */
export const PAST_VISIBILITY_DAYS = 7;

/** Data retention before soft delete in days */
export const RETENTION_DAYS = 30;

/** Schedule slot duration in minutes */
export const SCHEDULE_SLOT_MINUTES = 15;

/** Number of slots per day (24h / 15min) */
export const SLOTS_PER_DAY = 96;

/** Days of the week */
export const DAYS_OF_WEEK = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/** Paris arrondissements */
export const ARRONDISSEMENTS = [
  '1er', '2e', '3e', '4e', '5e', '6e', '7e', '8e', '9e', '10e',
  '11e', '12e', '13e', '14e', '15e', '16e', '17e', '18e', '19e', '20e',
] as const;

/** Nearby towns (petite couronne + close suburbs) */
export const NEARBY_TOWNS = [
  'Boulogne-Billancourt',
  'Issy-les-Moulineaux',
  'Vanves',
  'Malakoff',
  'Montrouge',
  'Gentilly',
  'Le Kremlin-Bicêtre',
  'Ivry-sur-Seine',
  'Charenton-le-Pont',
  'Saint-Mandé',
  'Vincennes',
  'Montreuil',
  'Les Lilas',
  'Le Pré-Saint-Gervais',
  'Pantin',
  'Aubervilliers',
  'Saint-Ouen',
  'Saint-Denis',
  'Clichy',
  'Levallois-Perret',
  'Neuilly-sur-Seine',
  'Puteaux',
  'Courbevoie',
  'La Garenne-Colombes',
  'Suresnes',
] as const;

/** All selectable areas */
export const ALL_AREAS = [...ARRONDISSEMENTS, ...NEARBY_TOWNS] as const;

/** Supported languages */
export const LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * Compute the valid EJM graduation year range.
 * Before Sep 1: current year to current year + 3.
 * From Sep 1 onwards: current year + 1 to current year + 4.
 */
export function getValidGraduationYears(now: Date = new Date()): number[] {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, so 8 = September
  const twoDigitYear = year % 100;

  if (month >= 8) {
    // September onwards: next school year
    return [twoDigitYear + 1, twoDigitYear + 2, twoDigitYear + 3, twoDigitYear + 4];
  }
  return [twoDigitYear, twoDigitYear + 1, twoDigitYear + 2, twoDigitYear + 3];
}
