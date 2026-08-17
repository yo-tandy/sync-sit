import { describe, it, expect } from 'vitest';
import { searchTutorsSchema } from '../search.js';

const BASE = { subject: 'math', level: '6e' };

describe('searchTutorsSchema — location prefs forms', () => {
  it('accepts the legacy single locationPref', () => {
    const parsed = searchTutorsSchema.safeParse({
      ...BASE,
      filters: { locationPref: 'online' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.filters?.locationPref).toBe('online');
  });

  it('accepts the multi-select locationPrefs array', () => {
    const parsed = searchTutorsSchema.safeParse({
      ...BASE,
      filters: { locationPrefs: ['online', 'family_home'] },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filters?.locationPrefs).toEqual(['online', 'family_home']);
    }
  });

  it('rejects unknown location values in the array', () => {
    const parsed = searchTutorsSchema.safeParse({
      ...BASE,
      filters: { locationPrefs: ['moon_base'] },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('searchTutorsSchema — areaLabel is degrade-to-absent', () => {
  it('accepts a short label', () => {
    const parsed = searchTutorsSchema.safeParse({ ...BASE, areaLabel: '16e' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.areaLabel).toBe('16e');
  });

  it('treats an over-long label as absent instead of rejecting', () => {
    const parsed = searchTutorsSchema.safeParse({
      ...BASE,
      areaLabel: 'x'.repeat(31),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.areaLabel).toBeUndefined();
  });

  it('treats a non-string label as absent instead of rejecting', () => {
    const parsed = searchTutorsSchema.safeParse({ ...BASE, areaLabel: 42 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.areaLabel).toBeUndefined();
  });
});
