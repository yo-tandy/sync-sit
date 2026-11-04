import { describe, it, expect } from 'vitest';
import { familyEnrollmentSchema } from '../enrollment.js';

const base = {
  familyName: 'Durand',
  firstName: 'Claire',
  address: '10 Rue Cler, 75007 Paris',
};

describe('familyEnrollmentSchema.language (issue #440 audit)', () => {
  it('is optional — legacy clients send nothing', () => {
    expect(familyEnrollmentSchema.safeParse(base).success).toBe(true);
  });

  it.each(['en', 'fr'] as const)("accepts '%s'", (language) => {
    const r = familyEnrollmentSchema.safeParse({ ...base, language });
    expect(r.success).toBe(true);
    expect(r.success && r.data.language).toBe(language);
  });

  it('rejects a language outside the supported set', () => {
    expect(familyEnrollmentSchema.safeParse({ ...base, language: 'de' }).success).toBe(false);
  });
});
