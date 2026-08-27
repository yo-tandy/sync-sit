import { describe, it, expect } from 'vitest';
import { capitalize, formatBabysitterName, formatProviderName, formatFamilyTitle } from '../formatName';

/**
 * Sit's formatName module became a re-export shim in PR #247 (parity D2):
 * `capitalize` and `formatProviderName` now live in `@ejm/shared-ui`, and
 * `formatBabysitterName` is a re-exported binding rather than a local
 * function.
 *
 * These pins exist because that binding has a quiet failure mode. Several
 * `apps/web` tests full-replace `@ejm/shared-ui` with
 * `vi.mock('@ejm/shared-ui', () => ({ ... }))`; none of them currently render
 * a page that imports this module, but if one ever does, the symptom is a
 * runtime `TypeError` at call time rather than an obvious missing-mock error.
 * A direct pin on the shim turns that into a fast, legible failure.
 */
describe('sit formatName shim', () => {
  it('re-exports the shared helpers, not stale local copies', () => {
    expect(capitalize('marie')).toBe('Marie');
    expect(formatProviderName('marie', 'dupont')).toBe('Marie DUPONT');
  });

  it('keeps formatBabysitterName working as the sit-era alias', () => {
    expect(formatBabysitterName('marie', 'dupont')).toBe('Marie DUPONT');
    expect(formatBabysitterName).toBe(formatProviderName);
  });

  it('carries the hyphen fix through to sit\'s surfaces', () => {
    // Sit's own cards had this bug before the extraction; the shim inherits
    // the fix rather than needing its own.
    expect(formatBabysitterName('jean-claude', 'dubois')).toBe('Jean-Claude DUBOIS');
  });

  it('keeps formatFamilyTitle local, with its sit-specific fallback', () => {
    expect(formatFamilyTitle('dupont')).toBe('DUPONT');
    expect(formatFamilyTitle(undefined)).toBe('Family');
    expect(formatFamilyTitle('')).toBe('Family');
  });
});
