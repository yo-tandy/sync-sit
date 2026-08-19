import { describe, it, expect } from 'vitest';
import { publishTutorSearchSchema } from '../publishSearch.js';

const BASE = { subject: 'math', level: '6e' };

describe('publishTutorSearchSchema (issue #207)', () => {
  it('accepts the minimal subject+level payload', () => {
    const parsed = publishTutorSearchSchema.safeParse(BASE);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.locationPrefs).toBeUndefined();
      expect(parsed.data.maxRate).toBeUndefined();
    }
  });

  it('accepts optional locationPrefs and maxRate', () => {
    const parsed = publishTutorSearchSchema.safeParse({
      ...BASE,
      locationPrefs: ['online', 'family_home'],
      maxRate: 30,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.locationPrefs).toEqual(['online', 'family_home']);
      expect(parsed.data.maxRate).toBe(30);
    }
  });

  it('rejects off-vocabulary subject/level and bad rates', () => {
    expect(publishTutorSearchSchema.safeParse({ subject: 'alchemy', level: '6e' }).success).toBe(false);
    expect(publishTutorSearchSchema.safeParse({ subject: 'math', level: '13e' }).success).toBe(false);
    expect(publishTutorSearchSchema.safeParse({ ...BASE, maxRate: -5 }).success).toBe(false);
  });

  it('has no location inputs beyond the session-type prefs (no latLng/areaLabel)', () => {
    // The published area label is resolved SERVER-SIDE from the family doc;
    // a client-supplied latLng/areaLabel must not slip through the schema.
    const parsed = publishTutorSearchSchema.safeParse({
      ...BASE,
      latLng: { lat: 48.85, lng: 2.35 },
      areaLabel: '16e',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('latLng' in parsed.data).toBe(false);
      expect('areaLabel' in parsed.data).toBe(false);
    }
  });
});
