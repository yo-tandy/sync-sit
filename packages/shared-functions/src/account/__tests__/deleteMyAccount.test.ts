import { describe, it, expect } from 'vitest';
import { assertSelfDeleteAllowed } from '../deleteMyAccount.js';

/**
 * Guards on the ONE irreversible thing a member can do to themselves
 * (issue #368). The Firestore erasure is covered by the emulator integration
 * suite; these pin the two checks that stand in front of it, because every
 * one of them failing OPEN deletes a real account.
 */
const NOW = 1_700_000_000_000; // ms
const NOW_S = Math.floor(NOW / 1000);
const OK = 'DELETE';

const code = (fn: () => void): string => {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
};

describe('assertSelfDeleteAllowed', () => {
  it('allows a fresh sign-in with the confirmation token', () => {
    expect(() => assertSelfDeleteAllowed(NOW_S - 60, NOW, OK)).not.toThrow();
  });

  it('allows right up to the 15-minute edge', () => {
    expect(() => assertSelfDeleteAllowed(NOW_S - 15 * 60, NOW, OK)).not.toThrow();
  });

  it('refuses one second past the window', () => {
    expect(code(() => assertSelfDeleteAllowed(NOW_S - 15 * 60 - 1, NOW, OK))).toBe(
      'failed-precondition',
    );
  });

  it('refuses a long-lived session — the borrowed-device case', () => {
    // The whole reason the window exists: an unattended signed-in phone must
    // not be enough to erase someone's account.
    expect(code(() => assertSelfDeleteAllowed(NOW_S - 30 * 24 * 3600, NOW, OK))).toBe(
      'failed-precondition',
    );
  });

  it.each([
    ['absent', 0],
    ['NaN', Number.NaN],
    ['negative', -1],
  ])('fails CLOSED on a %s auth_time', (_label, authTime) => {
    // An unexpected token shape is not permission.
    expect(code(() => assertSelfDeleteAllowed(authTime as number, NOW, OK))).toBe(
      'failed-precondition',
    );
  });

  it('fails closed on a FUTURE auth_time rather than treating it as very recent', () => {
    // Clock skew or tampering. `now - authTime` goes negative, which a naive
    // `age > WINDOW` check reads as "signed in moments ago".
    expect(code(() => assertSelfDeleteAllowed(NOW_S + 3600, NOW, OK))).toBe(
      'failed-precondition',
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['lowercase', 'delete'],
    ['padded', ' DELETE '],
    ['translated', 'SUPPRIMER'],
  ])('refuses a %s confirmation', (_label, confirm) => {
    expect(code(() => assertSelfDeleteAllowed(NOW_S - 60, NOW, confirm as string | undefined))).toBe(
      'invalid-argument',
    );
  });

  it('checks recency BEFORE the token, so a stale session cannot probe it', () => {
    // Both guards fail here. The recency error is the one that should surface:
    // telling a stale caller "wrong confirmation word" would confirm the word
    // is the only thing they are missing.
    expect(code(() => assertSelfDeleteAllowed(NOW_S - 30 * 24 * 3600, NOW, 'wrong'))).toBe(
      'failed-precondition',
    );
  });
});
