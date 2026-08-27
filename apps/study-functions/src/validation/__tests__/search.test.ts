import { describe, it, expect } from 'vitest';
import { searchTutorsSchema, lookupTutorSchema } from '../search.js';

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

describe('lookupTutorSchema — bounds (issue #235)', () => {
  it('accepts a trimmed 2-char query and rejects 1 char', () => {
    expect(lookupTutorSchema.safeParse({ query: ' ya ' }).success).toBe(true);
    expect(lookupTutorSchema.safeParse({ query: 'y' }).success).toBe(false);
  });
  it('rejects a query over 200 chars — the in-memory scan must never compare megabyte strings', () => {
    expect(lookupTutorSchema.safeParse({ query: 'x'.repeat(200) }).success).toBe(true);
    expect(lookupTutorSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
  });
  it('rejects non-string shapes instead of crashing into a 500', () => {
    expect(lookupTutorSchema.safeParse({ query: 42 }).success).toBe(false);
    expect(lookupTutorSchema.safeParse({}).success).toBe(false);
  });
});
