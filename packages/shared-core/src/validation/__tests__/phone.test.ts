import { describe, expect, it } from 'vitest';
import { isPlausiblePhone } from '../phone.js';

describe('isPlausiblePhone', () => {
  it.each([
    '+33 6 12 34 56 78',
    '06 12 34 56 78',
    '0612345678',
    '+1 (415) 555-0100',
    '01.23.45.67.89',
    '  +44 20 7946 0958  ',
    '123456',
  ])('accepts %s', (v) => {
    expect(isPlausiblePhone(v)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'abc',
    '06 12 ab 56 78',
    'call me',
    '12345',
    '+',
    '33+6 12 34 56 78',
    'name@example.com',
  ])('rejects %j', (v) => {
    expect(isPlausiblePhone(v)).toBe(false);
  });
});
