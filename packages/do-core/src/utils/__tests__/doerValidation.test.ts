import { describe, it, expect } from 'vitest';
import {
  validateDoerBio,
  validateDoerCategories,
  validateDoerDefaultRate,
} from '../validation.js';
import {
  DO_DOER_BIO_MAX,
  DO_PRICE_MAX,
  DO_PRICE_MIN,
  TASK_CATEGORIES,
} from '../../constants/index.js';
import { getDoerProfile } from '../../types/doerUserAdapter.js';
import type { User } from '@ejm/shared-core';

describe('validateDoerCategories', () => {
  it('accepts the full seven-category list (the doEnrollDoer default)', () => {
    expect(validateDoerCategories([...TASK_CATEGORIES])).toBeNull();
  });

  it('accepts a subset and the EMPTY array (explicit "no digests", §3.3)', () => {
    expect(validateDoerCategories(['ikea', 'it'])).toBeNull();
    expect(validateDoerCategories([])).toBeNull();
  });

  it('rejects non-arrays', () => {
    expect(validateDoerCategories(undefined)).toMatch(/array/);
    expect(validateDoerCategories('ikea')).toMatch(/array/);
    expect(validateDoerCategories({ 0: 'ikea' })).toMatch(/array/);
  });

  it('rejects unknown category strings and non-strings', () => {
    expect(validateDoerCategories(['ikea', 'plumbing'])).toMatch(/sync-do/);
    expect(validateDoerCategories([42])).toMatch(/sync-do/);
    expect(validateDoerCategories([null])).toMatch(/sync-do/);
  });

  it('rejects duplicates', () => {
    expect(validateDoerCategories(['ikea', 'ikea'])).toMatch(/repeat/);
  });
});

describe('validateDoerBio', () => {
  it('accepts a string within the bound, the empty string, and null (clear)', () => {
    expect(validateDoerBio('I like assembling furniture.')).toBeNull();
    expect(validateDoerBio('')).toBeNull();
    expect(validateDoerBio('x'.repeat(DO_DOER_BIO_MAX))).toBeNull();
    expect(validateDoerBio(null)).toBeNull();
  });

  it('rejects overlong strings and non-strings', () => {
    expect(validateDoerBio('x'.repeat(DO_DOER_BIO_MAX + 1))).toMatch(
      new RegExp(String(DO_DOER_BIO_MAX)),
    );
    expect(validateDoerBio(42)).toMatch(/string/);
    expect(validateDoerBio(undefined)).toMatch(/string/);
  });
});

describe('validateDoerDefaultRate', () => {
  it('accepts null (clear) and numbers on the shared price bounds', () => {
    expect(validateDoerDefaultRate(null)).toBeNull();
    expect(validateDoerDefaultRate(DO_PRICE_MIN)).toBeNull();
    expect(validateDoerDefaultRate(25)).toBeNull();
    expect(validateDoerDefaultRate(DO_PRICE_MAX)).toBeNull();
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(validateDoerDefaultRate(DO_PRICE_MIN - 1)).toMatch(/defaultRate/);
    expect(validateDoerDefaultRate(DO_PRICE_MAX + 1)).toMatch(/defaultRate/);
    expect(validateDoerDefaultRate(Number.NaN)).toMatch(/defaultRate/);
    expect(validateDoerDefaultRate('20')).toMatch(/defaultRate/);
    expect(validateDoerDefaultRate(undefined)).toMatch(/defaultRate/);
  });
});

describe('getDoerProfile', () => {
  it('narrows profiles.doer and passes null/undefined/absent through', () => {
    const doer = {
      enrollmentComplete: true,
      notifyNewTasks: true,
      categories: ['ikea'],
    };
    const user = { profiles: { doer } } as unknown as User;
    expect(getDoerProfile(user)).toBe(doer);
    expect(getDoerProfile(null)).toBeUndefined();
    expect(getDoerProfile(undefined)).toBeUndefined();
    expect(getDoerProfile({ profiles: {} } as unknown as User)).toBeUndefined();
  });
});
