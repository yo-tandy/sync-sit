import { describe, it, expect } from 'vitest';
import { humanizeNoticeWindow, isLateCancellationClient } from '../cancellationPolicy';

// A minimal t() stub — the only key humanize can look up is the week window.
const t = ((key: string) => (key === 'sessions.window.week' ? '1 week' : key)) as never;

describe('humanizeNoticeWindow', () => {
  it('renders 24 / 48 as an hour suffix', () => {
    expect(humanizeNoticeWindow(24, t)).toBe('24h');
    expect(humanizeNoticeWindow(48, t)).toBe('48h');
  });
  it('renders 168 as the translated one-week label', () => {
    expect(humanizeNoticeWindow(168, t)).toBe('1 week');
  });
});

// Paris is UTC+2 on 2026-07-29 (CEST): 10:00 wall = 08:00Z. `now` is exactly 24h
// before a 2026-07-30 10:00 start. The client check is approximate-by-design; the
// server flag is authoritative — these cases mirror the server unit boundaries.
const now = new Date('2026-07-29T08:00:00Z');

describe('isLateCancellationClient', () => {
  it('flags a cancel strictly inside the window', () => {
    expect(isLateCancellationClient('2026-07-30', '10:00', 48, now)).toBe(true);
  });
  it('does not flag exactly AT the cutoff (strict <)', () => {
    expect(isLateCancellationClient('2026-07-30', '10:00', 24, now)).toBe(false);
  });
  it('does not flag outside the window', () => {
    expect(isLateCancellationClient('2026-08-10', '10:00', 48, now)).toBe(false);
  });
  it('noticeHours 0 never flags, even seconds before start', () => {
    expect(isLateCancellationClient('2026-07-29', '10:05', 0, now)).toBe(false);
  });
  it('a cancel after the start is late', () => {
    expect(isLateCancellationClient('2026-07-28', '10:00', 24, now)).toBe(true);
  });
});
