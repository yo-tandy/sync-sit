import { describe, it, expect } from 'vitest';
import { ORIGINAL_AUTH_TIME_CLAIM, effectiveAuthTimeSeconds } from '../effectiveAuthTime.js';

// Pins the rule that closes the handoff re-auth bypass: a session's credential
// age is the OLDER of its own auth_time and the age carried across a cross-app
// handoff. Every guard that gates on "authenticated recently" reads this, so a
// wrong answer here is a delete accepted from a stale session.
describe('effectiveAuthTimeSeconds', () => {
  const OLD = 1_700_000_000; // a month-old session
  const NEW = 1_700_100_000; // the sign-in the handoff just stamped

  it('is auth_time when no handoff claim rode along', () => {
    expect(effectiveAuthTimeSeconds({ auth_time: NEW })).toBe(NEW);
  });

  it('prefers the OLDER carried claim over the handoff-refreshed auth_time', () => {
    // The bypass, in one assertion: without this the answer would be NEW, and
    // a month-old borrowed session would pass a 15-minute window.
    expect(
      effectiveAuthTimeSeconds({ auth_time: NEW, [ORIGINAL_AUTH_TIME_CLAIM]: OLD }),
    ).toBe(OLD);
  });

  it('still takes the older value when the claim is somehow the newer one', () => {
    // Cannot happen while createAppHandoffCode records this function's own
    // output, but taking the minimum means a claim that ever read newer could
    // only make a guard stricter, never looser.
    expect(
      effectiveAuthTimeSeconds({ auth_time: OLD, [ORIGINAL_AUTH_TIME_CLAIM]: NEW }),
    ).toBe(OLD);
  });

  it('falls back to the claim when auth_time is unusable', () => {
    expect(effectiveAuthTimeSeconds({ [ORIGINAL_AUTH_TIME_CLAIM]: OLD })).toBe(OLD);
    expect(
      effectiveAuthTimeSeconds({ auth_time: 0, [ORIGINAL_AUTH_TIME_CLAIM]: OLD }),
    ).toBe(OLD);
  });

  it.each([
    ['no token at all', undefined],
    ['empty token', {}],
    ['zero', { auth_time: 0 }],
    ['negative', { auth_time: -1 }],
    ['non-numeric', { auth_time: 'yesterday' }],
    ['NaN', { auth_time: Number.NaN }],
    ['Infinity', { auth_time: Number.POSITIVE_INFINITY }],
    ['null claim and null auth_time', { auth_time: null, [ORIGINAL_AUTH_TIME_CLAIM]: null }],
  ])('reports 0 (treated as stale) for %s', (_label, token) => {
    expect(effectiveAuthTimeSeconds(token as Record<string, unknown> | undefined)).toBe(0);
  });

  it('ignores a junk claim rather than letting it shorten a real auth_time', () => {
    // A claim we cannot parse must not be read as "credential at epoch 0" and
    // lock a member out of their own delete.
    expect(
      effectiveAuthTimeSeconds({ auth_time: NEW, [ORIGINAL_AUTH_TIME_CLAIM]: 'nonsense' }),
    ).toBe(NEW);
    expect(effectiveAuthTimeSeconds({ auth_time: NEW, [ORIGINAL_AUTH_TIME_CLAIM]: 0 })).toBe(NEW);
  });
});
