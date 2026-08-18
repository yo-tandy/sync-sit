import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  nextSendCounter,
  DAILY_SEND_CAP,
  DAILY_SEND_WINDOW_MS,
  BYPASS_SEND_CAP,
  BYPASS_SEND_WINDOW_MS,
} from '../sendRateLimit.js';

// Unit pins for the pure send-counter window logic (issue #155). The
// Firestore read/write wiring is covered by the emulator integration suite;
// these pin the window arithmetic and the malformed-data fallbacks.

const NOW = 1_700_000_000_000;

describe('nextSendCounter', () => {
  it('starts a fresh window at count 1 when no counter exists', () => {
    const next = nextSendCounter(undefined, NOW, DAILY_SEND_CAP, DAILY_SEND_WINDOW_MS);
    expect(next).toEqual({ count: 1, windowStart: new Date(NOW) });
  });

  it('increments within the window, preserving the window anchor', () => {
    const start = NOW - 60 * 60 * 1000; // 1h into the 24h window
    const next = nextSendCounter(
      { count: 4, windowStart: Timestamp.fromMillis(start) },
      NOW,
      DAILY_SEND_CAP,
      DAILY_SEND_WINDOW_MS,
    );
    expect(next).toEqual({ count: 5, windowStart: new Date(start) });
  });

  it('returns null (capped, no write) once count reaches the cap within the window', () => {
    const start = NOW - 60 * 60 * 1000;
    const next = nextSendCounter(
      { count: DAILY_SEND_CAP, windowStart: Timestamp.fromMillis(start) },
      NOW,
      DAILY_SEND_CAP,
      DAILY_SEND_WINDOW_MS,
    );
    expect(next).toBeNull();
  });

  it('a count that somehow overshot the cap (manual write, legacy data) still reads as capped', () => {
    const start = NOW - 60 * 60 * 1000;
    const next = nextSendCounter(
      { count: DAILY_SEND_CAP + 2, windowStart: Timestamp.fromMillis(start) },
      NOW,
      DAILY_SEND_CAP,
      DAILY_SEND_WINDOW_MS,
    );
    expect(next).toBeNull();
  });

  it('resets to a fresh window once the previous one has fully elapsed', () => {
    const start = NOW - DAILY_SEND_WINDOW_MS; // exactly elapsed
    const next = nextSendCounter(
      { count: DAILY_SEND_CAP, windowStart: Timestamp.fromMillis(start) },
      NOW,
      DAILY_SEND_CAP,
      DAILY_SEND_WINDOW_MS,
    );
    expect(next).toEqual({ count: 1, windowStart: new Date(NOW) });
  });

  it('one millisecond before window end is still inside the window', () => {
    const start = NOW - DAILY_SEND_WINDOW_MS + 1;
    const next = nextSendCounter(
      { count: DAILY_SEND_CAP, windowStart: Timestamp.fromMillis(start) },
      NOW,
      DAILY_SEND_CAP,
      DAILY_SEND_WINDOW_MS,
    );
    expect(next).toBeNull();
  });

  it('accepts a plain Date windowStart (parity with the cooldown reader)', () => {
    const start = NOW - 1000;
    const next = nextSendCounter(
      { count: 2, windowStart: new Date(start) },
      NOW,
      BYPASS_SEND_CAP,
      BYPASS_SEND_WINDOW_MS,
    );
    expect(next).toEqual({ count: 3, windowStart: new Date(start) });
  });

  it('treats malformed count/windowStart as a fresh window (fail-open to count 1, never lockout)', () => {
    for (const data of [
      { count: 'ten', windowStart: Timestamp.fromMillis(NOW - 1000) },
      { count: 3, windowStart: 'yesterday' },
      {},
    ]) {
      const next = nextSendCounter(data, NOW, DAILY_SEND_CAP, DAILY_SEND_WINDOW_MS);
      expect(next).toEqual({ count: 1, windowStart: new Date(NOW) });
    }
  });

  it('bypass constants pin the issue #155 allowance: 6 sends per uid per hour', () => {
    expect(BYPASS_SEND_CAP).toBe(6);
    expect(BYPASS_SEND_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('daily constants pin the issue #155 cap: 10 sends per address per 24h', () => {
    expect(DAILY_SEND_CAP).toBe(10);
    expect(DAILY_SEND_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
