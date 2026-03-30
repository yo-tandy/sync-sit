/**
 * Format babysitter name: First name capitalized, last name in ALL CAPS
 * e.g. "Marie DUPONT"
 */
export function formatBabysitterName(firstName?: string, lastName?: string): string {
  const first = firstName
    ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
    : '';
  const last = lastName ? lastName.toUpperCase() : '';
  return `${first} ${last}`.trim();
}

/**
 * Format family name in ALL CAPS
 * e.g. "DUPONT family"
 */
export function formatFamilyTitle(familyName?: string): string {
  if (!familyName) return 'Family';
  return `${familyName.toUpperCase()} family`;
}
