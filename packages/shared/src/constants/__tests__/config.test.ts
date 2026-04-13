import { describe, it, expect } from 'vitest';
import {
  getValidGraduationYears,
  SLOTS_PER_DAY,
  SCHEDULE_SLOT_MINUTES,
  DAYS_OF_WEEK,
  EJM_DOMAIN,
} from '../config.js';

describe('getValidGraduationYears', () => {
  it('returns 4 years before September', () => {
    const march2026 = new Date('2026-03-15');
    expect(getValidGraduationYears(march2026)).toEqual([26, 27, 28, 29]);
  });

  it('shifts range after September', () => {
    const oct2026 = new Date('2026-10-01');
    expect(getValidGraduationYears(oct2026)).toEqual([27, 28, 29, 30]);
  });

  it('September 1 is in the new range', () => {
    const sep1 = new Date('2026-09-01');
    expect(getValidGraduationYears(sep1)).toEqual([27, 28, 29, 30]);
  });

  it('August 31 is still in the old range', () => {
    const aug31 = new Date('2026-08-31');
    expect(getValidGraduationYears(aug31)).toEqual([26, 27, 28, 29]);
  });
});

describe('schedule constants', () => {
  it('has 96 slots per day (24h / 15min)', () => {
    expect(SLOTS_PER_DAY).toBe(96);
  });

  it('has 15-minute slot duration', () => {
    expect(SCHEDULE_SLOT_MINUTES).toBe(15);
  });

  it('96 slots * 15 min = 1440 min = 24 hours', () => {
    expect(SLOTS_PER_DAY * SCHEDULE_SLOT_MINUTES).toBe(1440);
  });
});

describe('other constants', () => {
  it('has 7 days of week', () => {
    expect(DAYS_OF_WEEK).toHaveLength(7);
    expect(DAYS_OF_WEEK[0]).toBe('mon');
    expect(DAYS_OF_WEEK[6]).toBe('sun');
  });

  it('EJM domain is ejm.org', () => {
    expect(EJM_DOMAIN).toBe('ejm.org');
  });
});
