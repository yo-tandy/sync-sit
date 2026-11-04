import { describe, expect, it } from 'vitest';
// The script guards its main() behind require.main, so importing it here only
// loads the pure helper (no firebase-admin resolution).
import { needsPatch } from '../backfill-437-remove-personal-code.cjs';

describe('needsPatch', () => {
  it('true for a tutor profile still carrying a personalCode string', () => {
    expect(
      needsPatch({ profiles: { tutor: { personalCode: 'DEADBEE0' } } }),
    ).toBe(true);
  });

  it('false once personalCode is absent', () => {
    expect(needsPatch({ profiles: { tutor: { searchable: true } } })).toBe(false);
  });

  it('false for a doc with no tutor profile at all', () => {
    expect(needsPatch({ profiles: { parent: { enrollmentComplete: true } } })).toBe(false);
    expect(needsPatch({ profiles: {} })).toBe(false);
    expect(needsPatch({})).toBe(false);
  });

  it('false for a babysitter profile even if it somehow carried the same key name', () => {
    // BabysitterProfile never had this field, but the check is scoped to
    // profiles.tutor specifically — defensive against a malformed doc.
    expect(
      needsPatch({ profiles: { babysitter: { personalCode: 'X' } } }),
    ).toBe(false);
  });

  it('false when personalCode is not a string (defensive against corrupt data)', () => {
    expect(needsPatch({ profiles: { tutor: { personalCode: null } } })).toBe(false);
    expect(needsPatch({ profiles: { tutor: { personalCode: 12345 } } })).toBe(false);
  });
});
