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
 * Capitalize the first letter of each word, where words are separated by
 * whitespace OR hyphens.
 * e.g. "yoav yaari" → "Yoav Yaari", "jean-claude" → "Jean-Claude"
 *
 * The hyphen half matters: French compound given names are commonly
 * hyphenated (Jean-Claude, Marie-Thérèse, Anne-Sophie), and splitting on
 * spaces alone lowercases everything after the hyphen — "Jean-claude". Sit's
 * original had this bug too; it only became visible when study's cards, which
 * previously rendered the raw field, started going through here.
 *
 * Apostrophes count too ("n'golo" → "N'Golo"). That is safe HERE because this
 * is a GIVEN-name helper: surnames never reach it, since `formatProviderName`
 * upper-cases them wholesale. The French particle problem ("Jeanne d'Arc",
 * "Marie de la Tour", where the particle keeps its lower case) is a surname
 * problem, so it cannot arise on this path.
 *
 * The split keeps its separators (odd indices of a capturing split), so the
 * original spacing and hyphenation survive verbatim.
 */
export function capitalize(str?: string): string {
  if (!str) return '';
  return str
    .split(/([\s\-']+)/)
    .map((part, i) => (i % 2 === 1 ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
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
