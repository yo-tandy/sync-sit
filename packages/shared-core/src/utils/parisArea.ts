import { ARRONDISSEMENTS, NEARBY_TOWNS } from '../constants/config.js';

/**
 * Postcode/city → coverage-area label resolution (issue #167).
 *
 * Tutors in arrondissement mode store coverage as ARRONDISSEMENTS /
 * NEARBY_TOWNS labels; family search addresses arrive as geocoded
 * postcode + city (AddressAutocomplete payload). These helpers translate the
 * address side into the same label vocabulary so searchTutors can intersect
 * the two without geocoding heuristics.
 */

/** Case- and diacritic-insensitive canonical form for city matching. */
function canonical(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const TOWN_BY_CANONICAL = new Map<string, string>(
  NEARBY_TOWNS.map((town) => [canonical(town), town]),
);

/**
 * '75001' → '1er', '75002' → '2e' … '75020' → '20e'. The 16e has TWO codes:
 * 75016 and 75116 (the historic "Paris Cedex 16" range still returned by
 * geocoders for parts of the arrondissement). Anything else → null.
 */
export function postcodeToArrondissement(postcode: string): string | null {
  const trimmed = postcode.trim();
  if (trimmed === '75116') return '16e';
  const match = /^750(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const n = Number(match[1]);
  if (n < 1 || n > 20) return null;
  return ARRONDISSEMENTS[n - 1];
}

/**
 * Case/diacritic-insensitive match against NEARBY_TOWNS; returns the
 * CANONICAL constant value (the vocabulary tutors' coverage stores), or null.
 */
export function cityToNearbyTown(city: string): string | null {
  return TOWN_BY_CANONICAL.get(canonical(city)) ?? null;
}

/**
 * Resolve an address to a coverage-area label: arrondissement first (postcode
 * is the more precise signal), nearby-town fallback, else null.
 */
export function resolveAreaLabel(address: {
  postcode?: string;
  city?: string;
}): string | null {
  if (address.postcode) {
    const arr = postcodeToArrondissement(address.postcode);
    if (arr) return arr;
  }
  if (address.city) {
    return cityToNearbyTown(address.city);
  }
  return null;
}
