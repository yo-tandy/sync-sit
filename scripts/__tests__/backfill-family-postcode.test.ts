import { describe, expect, it } from 'vitest';
// The script guards its main() behind require.main, so importing it here only
// loads the pure helpers (no firebase-admin resolution, no network).
import {
  extractPostcodeCity,
  needsBackfill,
  GEOCODE_URL,
} from '../backfill-family-postcode.cjs';

// A trimmed real-shape api-adresse /search response.
function apiResponse(properties: Record<string, unknown> | null) {
  return properties === null ? { features: [] } : { features: [{ properties }] };
}

describe('extractPostcodeCity', () => {
  it('extracts postcode and city from the top feature', () => {
    expect(
      extractPostcodeCity(
        apiResponse({ label: '15 Rue de Passy 75016 Paris', postcode: '75016', city: 'Paris' }),
      ),
    ).toEqual({ postcode: '75016', city: 'Paris' });
  });

  it('returns null for an empty feature list (no geocoder match)', () => {
    expect(extractPostcodeCity(apiResponse(null))).toBeNull();
  });

  it('returns null when either component is missing or non-string', () => {
    expect(extractPostcodeCity(apiResponse({ postcode: '75016' }))).toBeNull();
    expect(extractPostcodeCity(apiResponse({ city: 'Paris' }))).toBeNull();
    expect(extractPostcodeCity(apiResponse({ postcode: 75016, city: 'Paris' }))).toBeNull();
    expect(extractPostcodeCity(apiResponse({ postcode: '75016', city: 42 }))).toBeNull();
  });

  it('returns null on malformed/absent responses', () => {
    expect(extractPostcodeCity(undefined)).toBeNull();
    expect(extractPostcodeCity({})).toBeNull();
    expect(extractPostcodeCity({ features: 'nope' })).toBeNull();
  });

  it('rejects values beyond the schema/rules bounds (20/100)', () => {
    expect(
      extractPostcodeCity(apiResponse({ postcode: 'x'.repeat(21), city: 'Paris' })),
    ).toBeNull();
    expect(
      extractPostcodeCity(apiResponse({ postcode: '75016', city: 'x'.repeat(101) })),
    ).toBeNull();
  });
});

describe('needsBackfill', () => {
  it('selects docs with an address and missing or null postcode', () => {
    expect(needsBackfill({ address: '1 Rue de Paris' })).toBe(true);
    expect(needsBackfill({ address: '1 Rue de Paris', postcode: null })).toBe(true);
  });

  it('never touches docs that already carry a postcode (idempotence)', () => {
    expect(needsBackfill({ address: '1 Rue de Paris', postcode: '75001' })).toBe(false);
  });

  it('skips docs without a usable address', () => {
    expect(needsBackfill({})).toBe(false);
    expect(needsBackfill({ address: '' })).toBe(false);
    expect(needsBackfill({ address: '   ' })).toBe(false);
    expect(needsBackfill({ address: 42 })).toBe(false);
    expect(needsBackfill(undefined)).toBe(false);
  });
});

describe('endpoint', () => {
  it('targets the same geocoder AddressAutocomplete uses', () => {
    expect(GEOCODE_URL).toBe('https://api-adresse.data.gouv.fr/search/');
  });
});
