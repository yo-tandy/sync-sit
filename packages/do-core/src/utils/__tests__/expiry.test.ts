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
      { timing: 'fixed', date: '2026-10-15', startTime: null, endTime: null, dueDate: null, startDate: null },
      NOW,
    );
    expect(expires.toISOString()).toBe('2026-10-15T22:00:00.000Z');
    expect(expires.getTime()).toBeGreaterThan(
      NOW.getTime() + DO_ONGOING_TTL_DAYS * 24 * HOUR,
    );
  });

  it('fixed crossing midnight (endTime <= startTime): expires at the end of the day it ENDS', () => {
    // The other half of the publishSearch one_time precedent (PR #210
    // review): a 20:00–01:00 clean-up dated the 12th ends on the 13th, so
    // it must not expire an hour before it finishes.
    const expires = computeTaskExpiresAt(
      {
        timing: 'fixed',
        date: '2026-09-12',
        startTime: '20:00',
        endTime: '01:00',
        dueDate: null,
        startDate: null,
      },
      NOW,
    );
    expect(expires.toISOString()).toBe('2026-09-13T22:00:00.000Z');
    // equal times count as crossing too (validateTaskTiming legalizes both)
    expect(
      computeTaskExpiresAt(
        {
          timing: 'fixed',
          date: '2026-09-12',
          startTime: '22:00',
          endTime: '22:00',
          dueDate: null,
          startDate: null,
        },
        NOW,
      ).toISOString(),
    ).toBe('2026-09-13T22:00:00.000Z');
    // a normal same-day task keeps the §6.3 end-of-its-own-day expiry
    expect(
      computeTaskExpiresAt(
        {
          timing: 'fixed',
          date: '2026-09-12',
          startTime: '14:00',
          endTime: '18:00',
          dueDate: null,
          startDate: null,
        },
        NOW,
      ).toISOString(),
    ).toBe('2026-09-12T22:00:00.000Z');
  });

  it('fixed crossing midnight over the DST edge ends on the 23h day, DST-correctly', () => {
    // Dated 2026-03-28 (CET), 22:00–02:00: ends on 2026-03-29, the
    // spring-forward day, whose end is 22:00Z (CEST) — end-of-next-day via
    // the calendar, not a naive +24h on the day-end instant (which would
    // land at 23:00Z here).
    const expires = computeTaskExpiresAt(
      {
        timing: 'fixed',
        date: '2026-03-28',
        startTime: '22:00',
        endTime: '02:00',
        dueDate: null,
        startDate: null,
      },
      NOW,
    );
    expect(expires.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('deadline: end of dueDate', () => {
    const expires = computeTaskExpiresAt(
      {
        timing: 'deadline',
        date: null,
        startTime: null,
        endTime: null,
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
        startTime: null,
        endTime: null,
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
        startTime: null,
        endTime: null,
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
        { timing: 'fixed', date: null, startTime: null, endTime: null, dueDate: null, startDate: null },
        NOW,
      ),
    ).toThrow();
    expect(() =>
      computeTaskExpiresAt(
        { timing: 'deadline', date: null, startTime: null, endTime: null, dueDate: null, startDate: null },
        NOW,
      ),
    ).toThrow();
    expect(() =>
      computeTaskExpiresAt(
        { timing: 'recurring', date: null, startTime: null, endTime: null, dueDate: null, startDate: null },
        NOW,
      ),
    ).toThrow();
  });

  it('throws on a timing outside the union instead of returning undefined', () => {
    // Without the default case the switch falls off the end and doPostTask
    // would write expiresAt: undefined — a task the §6.5 sweep never
    // collects.
    expect(() =>
      computeTaskExpiresAt(
        {
          timing: 'sometime' as 'fixed',
          date: '2026-09-12',
          startTime: null,
          endTime: null,
          dueDate: null,
          startDate: null,
        },
        NOW,
      ),
    ).toThrow(/unknown task timing/);
  });
});

// ── Agreement test (issue #309) ──────────────────────────────────────────────
// expiry.ts used to carry a documented verbatim copy of parisWallTimeToUtc
// (it cannot depend on shared-functions); the copy is gone and both do-core
// and shared-functions now import the one hoisted implementation from
// @ejm/shared-core. Pin the import identity so a reintroduced local copy
// (silently forking the DST behavior between the sit/study crons and do
// expiry) fails loudly here.
describe('shared-core agreement (#309)', () => {
  it('re-exports the exact shared-core parisWallTimeToUtc, not a copy', async () => {
    const sharedCore = await import('@ejm/shared-core/utils/parisTime.js');
    expect(parisWallTimeToUtc).toBe(sharedCore.parisWallTimeToUtc);
  });
});
