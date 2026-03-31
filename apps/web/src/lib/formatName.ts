/**
 * Capitalize the first letter of each word.
 * e.g. "yoav yaari" → "Yoav Yaari"
 */
export function capitalize(str?: string): string {
  if (!str) return '';
  return str
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format babysitter name: First name capitalized, last name in ALL CAPS
 * e.g. "Marie DUPONT"
 */
export function formatBabysitterName(firstName?: string, lastName?: string): string {
  const first = capitalize(firstName);
  const last = lastName ? lastName.toUpperCase() : '';
  return `${first} ${last}`.trim();
}

/**
 * Format family name: ALL CAPS
 * e.g. "NIV YAARI"
 */
export function formatFamilyTitle(familyName?: string): string {
  if (!familyName) return 'Family';
  return familyName.toUpperCase();
}
