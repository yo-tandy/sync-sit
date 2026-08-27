/**
 * Person-name presentation, shared by both apps (parity D2, issue #240).
 *
 * Sit's result cards printed "Lea BERNARD" and study's printed "Camille
 * Moreau" — pure formatting drift, with no privacy rationale behind it: both
 * apps disclose full surnames pre-approval, so neither form was hiding
 * anything the other showed. Sit's is the production-verified default and the
 * French form convention (given name in title case, family name in caps), so
 * it wins and lives here rather than in either app.
 */

/**
 * Capitalize the first letter of each whitespace-separated word.
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
 * A provider's display name: given name in title case, family name in caps.
 * e.g. formatProviderName('marie', 'dupont') → "Marie DUPONT"
 *
 * Either half may be missing — a legacy or partially-enrolled doc can carry
 * one and not the other — so the result is trimmed and a single missing half
 * degrades to the other rather than to a stray space.
 */
export function formatProviderName(firstName?: string, lastName?: string): string {
  const first = capitalize(firstName);
  const last = lastName ? lastName.toUpperCase() : '';
  return `${first} ${last}`.trim();
}
