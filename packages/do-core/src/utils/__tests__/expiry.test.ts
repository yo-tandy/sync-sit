import { describe, it, expect } from 'vitest';
import {
  computeTaskExpiresAt,
  endOfParisDay,
  parisWallTimeToUtc,
} from '../expiry.js';
import { DO_ONGOING_TTL_DAYS } from '../../constants/index.js';

const HOUR = 60 * 60 * 1000;

// A fixed "now" so ongoing results are deterministic.
const NOW = new Date('2026-08-28T10:15:00Z');

describe('parisWallTimeToUtc', () => {
  it('converts a winter (CET, +1) wall time', () => {
    expect(parisWallTimeToUtc('2026-01-15', '18:30').toISOString()).toBe(
      '2026-01-15T17:30:00.000Z',
    );
  });

  it('converts a summer (CEST, +2) wall time', () => {
    expect(parisWallTimeToUtc('2026-07-10', '18:30').toISOString()).toBe(
      '2026-07-10T16:30:00.000Z',
    );
  });
});

describe('endOfParisDay', () => {
  it('ends a winter day at 23:00Z (next Paris midnight, CET)', () => {
    expect(endOfParisDay('2026-01-15').toISOString()).toBe(
      '2026-01-15T23:00:00.000Z',
    );
  });

  it('ends a summer day at 22:00Z (next Paris midnight, CEST)', () => {
    expect(endOfParisDay('2026-07-10').toISOString()).toBe(
      '2026-07-10T22:00:00.000Z',
    );
  });

  it('spring-forward day (2026-03-29) is 23 hours long and ends at 22:00Z', () => {
    // Clocks jump 02:00 → 03:00 on 2026-03-29; its midnight-to-midnight span
    // is 23h, and the day ends already on CEST.
    const end = endOfParisDay('2026-03-29');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    const prevEnd = endOfParisDay('2026-03-28'); // still CET: 23:00Z
    expect(prevEnd.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.getTime() - prevEnd.getTime()).toBe(23 * HOUR);
  });

  it('fall-back day (2026-10-25) is 25 hours long and ends at 23:00Z', () => {
    // Clocks fall 03:00 → 02:00 on 2026-10-25; 25h day, ends back on CET.
    const end = endOfParisDay('2026-10-25');
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    const prevEnd = endOfParisDay('2026-10-24'); // still CEST: 22:00Z
    expect(prevEnd.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(end.getTime() - prevEnd.getTime()).toBe(25 * HOUR);
  });

  it('handles a month rollover', () => {
    expect(endOfParisDay('2026-01-31').toISOString()).toBe(
      '2026-01-31T23:00:00.000Z',
    );
    expect(endOfParisDay('2026-12-31').toISOString()).toBe(
      '2026-12-31T23:00:00.000Z',
    );
  });
});

describe('computeTaskExpiresAt (§6.3)', () => {
  it('fixed: end of the task day — no TTL cap for a far-out date', () => {
    // The §6.3 regression: a family posting "help me move on 15 October" in
    // late August keeps the post until the move date, not now + 14d.
    const expires = computeTaskExpiresAt(
      { timing: 'fixed', date: '2026-10-15', dueDate: null, startDate: null },
      NOW,
    );
    expect(expires.toISOString()).toBe('2026-10-15T22:00:00.000Z');
    expect(expires.getTime()).toBeGreaterThan(
      NOW.getTime() + DO_ONGOING_TTL_DAYS * 24 * HOUR,
    );
  });

  it('deadline: end of dueDate', () => {
    const expires = computeTaskExpiresAt(
      {
        timing: 'deadline',
        date: null,
        dueDate: '2026-09-04',
        startDate: null,
      },
      NOW,
    );
    expect(expires.toISOString()).toBe('2026-09-04T22:00:00.000Z');
  });

  it('recurring: end of startDate — the offer window closes when the series starts', () => {
    const expires = computeTaskExpiresAt(
      {
        timing: 'recurring',
        date: null,
        dueDate: null,
        startDate: '2026-11-02',
      },
      NOW,
    );
    // November: CET again.
    expect(expires.toISOString()).toBe('2026-11-02T23:00:00.000Z');
  });

  it('ongoing: exactly now + 14 days, dates ignored', () => {
    const expires = computeTaskExpiresAt(
      {
        timing: 'ongoing',
        date: null,
        dueDate: null,
        startDate: '2026-08-30',
      },
      NOW,
    );
    expect(expires.getTime()).toBe(
      NOW.getTime() + DO_ONGOING_TTL_DAYS * 24 * HOUR,
    );
  });

  it('throws on a timing group missing its date instead of minting Invalid Date', () => {
    expect(() =>
      computeTaskExpiresAt(
        { timing: 'fixed', date: null, dueDate: null, startDate: null },
        NOW,
      ),
    ).toThrow();
    expect(() =>
      computeTaskExpiresAt(
        { timing: 'deadline', date: null, dueDate: null, startDate: null },
        NOW,
      ),
    ).toThrow();
    expect(() =>
      computeTaskExpiresAt(
        { timing: 'recurring', date: null, dueDate: null, startDate: null },
        NOW,
      ),
    ).toThrow();
  });
});
