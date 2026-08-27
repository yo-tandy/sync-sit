import { describe, it, expect } from 'vitest';
import { humanizeNoticeWindow } from '../cancellationPolicy';

// A minimal t() stub — the only key humanize can look up is the week window.
// (Sit twin of study-web's utils test; sit has no client-side late check —
// the server flag from cancelAppointment is the only classifier.)
const t = ((key: string) => (key === 'search.window.week' ? '1 week' : key)) as never;

describe('humanizeNoticeWindow', () => {
  it('renders 24 / 48 as an hour suffix', () => {
    expect(humanizeNoticeWindow(24, t)).toBe('24h');
    expect(humanizeNoticeWindow(48, t)).toBe('48h');
  });
  it('renders 168 as the translated one-week label', () => {
    expect(humanizeNoticeWindow(168, t)).toBe('1 week');
  });
});
