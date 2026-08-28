import { describe, it, expect } from 'vitest';
import {
  parisDateString,
  parisWallTimeToUtc,
  parisWallClockPosition,
} from '../parisTime.js';

// These exercise the shared-functions copy of the Paris wall-clock helpers.
// The study crons and the sit reminder cron both consume this same code path
// (sit via the ./parisTime.js re-export), so the DST correctness proven here
// covers both apps. Assertions are absolute UTC instants so they hold on any
// machine timezone (the whole point of these helpers).

const iso = (d: Date) => d.toISOString();

describe('parisWallTimeToUtc', () => {
  it('interprets winter wall time as CET (UTC+1)', () => {
    // 2026-01-15 is standard time: Paris noon == 11:00 UTC.
    expect(iso(parisWallTimeToUtc('2026-01-15', '12:00'))).toBe(
      '2026-01-15T11:00:00.000Z',
    );
  });

  it('interprets summer wall time as CEST (UTC+2)', () => {
    // 2026-07-15 is daylight time: Paris noon == 10:00 UTC.
    expect(iso(parisWallTimeToUtc('2026-07-15', '12:00'))).toBe(
      '2026-07-15T10:00:00.000Z',
    );
  });

  it('handles the autumn fall-back day (2026-10-25): times after 03:00 are CET', () => {
    // Clocks go 03:00 CEST -> 02:00 CET; 09:00 wall is unambiguously CET.
    expect(iso(parisWallTimeToUtc('2026-10-25', '09:00'))).toBe(
      '2026-10-25T08:00:00.000Z',
    );
  });

  it('handles the spring-forward day (2027-03-28): times after 03:00 are CEST', () => {
    // Clocks go 02:00 CET -> 03:00 CEST; 09:00 wall is unambiguously CEST.
    // The two-pass offset correction keeps guesses that land on the wrong
    // side of the transition from drifting (the #74 fix).
    expect(iso(parisWallTimeToUtc('2027-03-28', '09:00'))).toBe(
      '2027-03-28T07:00:00.000Z',
    );
  });

  it('round-trips through parisDateString across a DST boundary', () => {
    for (const date of ['2026-01-15', '2026-07-15', '2026-10-25', '2027-03-28']) {
      expect(parisDateString(parisWallTimeToUtc(date, '12:00'))).toBe(date);
    }
  });
});

describe('parisDateString', () => {
  it('reports the Paris calendar date, not the UTC one', () => {
    // 23:30 UTC in summer (CEST) is already 01:30 the next day in Paris.
    expect(parisDateString(new Date('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
    // 21:30 UTC in summer is 23:30 same day in Paris.
    expect(parisDateString(new Date('2026-07-14T21:30:00Z'))).toBe('2026-07-14');
  });

  it('reports the Paris date in winter (CET offset)', () => {
    // 23:30 UTC in winter (CET) is 00:30 the next day in Paris.
    expect(parisDateString(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15');
  });
});

describe('parisWallClockPosition', () => {
  it('reports the Paris date and minutes-since-midnight in summer (CEST)', () => {
    // 12:30 UTC in summer is 14:30 Paris → 14*60 + 30 = 870.
    expect(parisWallClockPosition(new Date('2026-07-15T12:30:00Z'))).toEqual({
      date: '2026-07-15',
      minutesSinceMidnight: 870,
    });
  });

  it('reports the Paris date and minutes-since-midnight in winter (CET)', () => {
    // 12:30 UTC in winter is 13:30 Paris → 13*60 + 30 = 810.
    expect(parisWallClockPosition(new Date('2026-01-15T12:30:00Z'))).toEqual({
      date: '2026-01-15',
      minutesSinceMidnight: 810,
    });
  });

  it('rolls the date forward when the instant is past Paris midnight', () => {
    // 23:30 UTC summer is 01:30 the next day in Paris → date advances, 90 min.
    expect(parisWallClockPosition(new Date('2026-07-15T23:30:00Z'))).toEqual({
      date: '2026-07-16',
      minutesSinceMidnight: 90,
    });
  });
});

// ── Agreement test (issue #309) ──────────────────────────────────────────────
// The implementation was hoisted into @ejm/shared-core; this module is now a
// re-export shim. Pin the import identity so a future edit that reintroduces
// a local copy (silently forking the DST behavior) fails loudly here.
describe('shared-core agreement (#309)', () => {
  it('re-exports the exact shared-core functions, not a copy', async () => {
    const sharedCore = await import('@ejm/shared-core/utils/parisTime.js');
    expect(parisWallTimeToUtc).toBe(sharedCore.parisWallTimeToUtc);
    expect(parisDateString).toBe(sharedCore.parisDateString);
    expect(parisWallClockPosition).toBe(sharedCore.parisWallClockPosition);
  });
});
