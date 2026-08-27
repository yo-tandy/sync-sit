import { describe, it, expect } from 'vitest';
import { lookupTutorSchema } from '../lookup.js';

/**
 * lookupTutor input schema (issue #235). The contract under test: human
 * relay noise (case, whitespace, dashes) normalizes away; anything that does
 * not collapse to exactly 8 hex chars is rejected BEFORE it can reach a
 * Firestore query.
 */
describe('lookupTutorSchema', () => {
  it('accepts a canonical 8-hex-char code unchanged', () => {
    const parsed = lookupTutorSchema.safeParse({ code: '4F7A2C9B' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe('4F7A2C9B');
  });

  it('uppercases a lowercase code', () => {
    const parsed = lookupTutorSchema.safeParse({ code: '4f7a2c9b' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe('4F7A2C9B');
  });

  it('strips whitespace and dashes (codes get read aloud and pasted)', () => {
    const parsed = lookupTutorSchema.safeParse({ code: ' 4f7a-2c9b\t' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe('4F7A2C9B');
  });

  it('rejects a code that is too short after normalization', () => {
    expect(lookupTutorSchema.safeParse({ code: '4F7A2C9' }).success).toBe(false);
  });

  it('rejects a code that is too long after normalization', () => {
    expect(lookupTutorSchema.safeParse({ code: '4F7A2C9B0' }).success).toBe(false);
  });

  it('rejects non-hex characters (G-Z are not in the mint alphabet)', () => {
    expect(lookupTutorSchema.safeParse({ code: '4F7A2C9G' }).success).toBe(false);
    expect(lookupTutorSchema.safeParse({ code: 'ZZZZZZZZ' }).success).toBe(false);
  });

  it('rejects an empty code and a missing code', () => {
    expect(lookupTutorSchema.safeParse({ code: '' }).success).toBe(false);
    expect(lookupTutorSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string code', () => {
    expect(lookupTutorSchema.safeParse({ code: 12345678 }).success).toBe(false);
  });

  it('rejects over-long junk before the transform runs (64-char pre-bound)', () => {
    expect(lookupTutorSchema.safeParse({ code: 'A'.repeat(65) }).success).toBe(false);
    // 64 chars of separator noise around a real code still normalizes fine.
    const noisy = `${' '.repeat(20)}4f7a2c9b${'-'.repeat(20)}`;
    const parsed = lookupTutorSchema.safeParse({ code: noisy });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe('4F7A2C9B');
  });
});
