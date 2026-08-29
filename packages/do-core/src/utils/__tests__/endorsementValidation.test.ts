import { describe, it, expect } from 'vitest';
import {
  isEndorsementAction,
  validateEndorsementRefName,
  validateEndorsementText,
} from '../validation.js';
import {
  DO_ENDORSEMENT_REF_NAME_MAX,
  DO_ENDORSEMENT_TEXT_MAX,
  DO_ENDORSEMENT_TEXT_MIN,
} from '../../constants/index.js';

describe('validateEndorsementText', () => {
  it('accepts a body at and above the floor', () => {
    expect(validateEndorsementText('a'.repeat(DO_ENDORSEMENT_TEXT_MIN))).toBeNull();
    expect(validateEndorsementText('Assembled our PAX beautifully.')).toBeNull();
  });

  it('rejects a non-string', () => {
    expect(validateEndorsementText(undefined)).toMatch(/required/);
    expect(validateEndorsementText(42)).toMatch(/required/);
    expect(validateEndorsementText(null)).toMatch(/required/);
  });

  it('rejects a body below the floor', () => {
    expect(validateEndorsementText('Great!')).toMatch(/at least/);
    expect(validateEndorsementText('a'.repeat(DO_ENDORSEMENT_TEXT_MIN - 1))).toMatch(/at least/);
  });

  // The floor is measured AFTER trimming, so padding cannot buy length —
  // the callable stores the trimmed string, and a validator that measured
  // the raw input would let ' ' * 20 through as a 20-char endorsement.
  it('measures the floor after trimming (whitespace cannot satisfy it)', () => {
    expect(validateEndorsementText(' '.repeat(DO_ENDORSEMENT_TEXT_MIN + 10))).toMatch(/at least/);
    expect(validateEndorsementText(`   ${'a'.repeat(DO_ENDORSEMENT_TEXT_MIN - 1)}   `)).toMatch(/at least/);
  });

  it('rejects a body above the ceiling, measured after trimming', () => {
    expect(validateEndorsementText('a'.repeat(DO_ENDORSEMENT_TEXT_MAX + 1))).toMatch(/at most/);
    // Trailing whitespace that only breaches the ceiling is NOT a rejection:
    // the stored value is the trimmed one.
    expect(validateEndorsementText(`${'a'.repeat(DO_ENDORSEMENT_TEXT_MAX)}    `)).toBeNull();
  });
});

describe('validateEndorsementRefName', () => {
  it('accepts a normal name', () => {
    expect(validateEndorsementRefName('Marie Dupont')).toBeNull();
  });

  it('rejects empty, whitespace-only and non-strings', () => {
    expect(validateEndorsementRefName('')).toMatch(/required/);
    expect(validateEndorsementRefName('   ')).toMatch(/required/);
    expect(validateEndorsementRefName(undefined)).toMatch(/required/);
  });

  it('rejects an over-long name', () => {
    expect(validateEndorsementRefName('a'.repeat(DO_ENDORSEMENT_REF_NAME_MAX + 1))).toMatch(/at most/);
    expect(validateEndorsementRefName('a'.repeat(DO_ENDORSEMENT_REF_NAME_MAX))).toBeNull();
  });
});

describe('isEndorsementAction', () => {
  it('accepts exactly accept and decline', () => {
    expect(isEndorsementAction('accept')).toBe(true);
    expect(isEndorsementAction('decline')).toBe(true);
  });

  // 'dismiss' is STUDY's vocabulary (respondTutorEndorsementSchema). sync-do
  // says 'decline' throughout its own surfaces, so the study word must not
  // be silently accepted here — a copy-pasted study payload should fail
  // loudly rather than take an undocumented path.
  it('rejects study\'s "dismiss" and everything else', () => {
    expect(isEndorsementAction('dismiss')).toBe(false);
    expect(isEndorsementAction('remove')).toBe(false);
    expect(isEndorsementAction('')).toBe(false);
    expect(isEndorsementAction(undefined)).toBe(false);
  });
});
