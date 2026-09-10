import { describe, it, expect } from 'vitest';
import { lookupBabysitterSchema } from '../lookup.js';

describe('lookupBabysitterSchema', () => {
  it('accepts a plain query unchanged', () => {
    const parsed = lookupBabysitterSchema.safeParse({ query: 'Marie Dupont' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.query).toBe('Marie Dupont');
  });

  it('trims surrounding whitespace', () => {
    const parsed = lookupBabysitterSchema.safeParse({ query: '  marie  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.query).toBe('marie');
  });

  it('rejects a query under 2 characters after trimming', () => {
    expect(lookupBabysitterSchema.safeParse({ query: 'm' }).success).toBe(false);
    expect(lookupBabysitterSchema.safeParse({ query: '  m  ' }).success).toBe(false);
  });

  it('rejects an empty or missing query', () => {
    expect(lookupBabysitterSchema.safeParse({ query: '' }).success).toBe(false);
    expect(lookupBabysitterSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string query', () => {
    expect(lookupBabysitterSchema.safeParse({ query: 12345 }).success).toBe(false);
  });

  it('rejects over-long junk before the trim runs (100-char pre-bound)', () => {
    expect(lookupBabysitterSchema.safeParse({ query: 'a'.repeat(101) }).success).toBe(false);
    const parsed = lookupBabysitterSchema.safeParse({ query: 'a'.repeat(100) });
    expect(parsed.success).toBe(true);
  });
});
