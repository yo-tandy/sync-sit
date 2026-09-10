import { describe, it, expect } from 'vitest';
import { lookupTutorSchema } from '../lookup.js';

describe('lookupTutorSchema', () => {
  it('accepts a plain query unchanged', () => {
    const parsed = lookupTutorSchema.safeParse({ query: 'Marie Dupont' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.query).toBe('Marie Dupont');
  });

  it('trims surrounding whitespace', () => {
    const parsed = lookupTutorSchema.safeParse({ query: '  marie  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.query).toBe('marie');
  });

  it('rejects a query under 2 characters after trimming', () => {
    expect(lookupTutorSchema.safeParse({ query: 'm' }).success).toBe(false);
    expect(lookupTutorSchema.safeParse({ query: '  m  ' }).success).toBe(false);
  });

  it('rejects an empty or missing query', () => {
    expect(lookupTutorSchema.safeParse({ query: '' }).success).toBe(false);
    expect(lookupTutorSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string query', () => {
    expect(lookupTutorSchema.safeParse({ query: 12345 }).success).toBe(false);
  });

  it('rejects over-long junk before the trim runs (100-char pre-bound)', () => {
    expect(lookupTutorSchema.safeParse({ query: 'a'.repeat(101) }).success).toBe(false);
    const parsed = lookupTutorSchema.safeParse({ query: 'a'.repeat(100) });
    expect(parsed.success).toBe(true);
  });
});
