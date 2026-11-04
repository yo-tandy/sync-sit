import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `notifyBlockedMinorBestEffort` (issue #421, option 1b): the swallow itself.
 *
 * The erasure has already blocked the child and committed several earlier
 * steps by the time this runs -- a thrown notification error must never
 * escape and abort it, exactly the failure `commitInChunks`'s own docblock
 * describes for the batch-chunking guard. This is the one thing this file
 * exists to pin: `notifyBlockedMinor`'s own CONTENT (copy, channels,
 * localisation) lives in `notifyBlockedMinor.test.ts`, which mocks the
 * transports instead of the function itself.
 */

const h = vi.hoisted(() => ({
  impl: (async () => ({ emailSent: true, pushSent: true })) as (
    ...args: unknown[]
  ) => Promise<{ emailSent: boolean; pushSent: boolean }>,
}));

vi.mock('../notifyBlockedMinor.js', () => ({
  notifyBlockedMinor: (...args: unknown[]) => h.impl(...args),
}));

import { notifyBlockedMinorBestEffort } from '../notifyBlockedMinorBestEffort.js';

describe('notifyBlockedMinorBestEffort', () => {
  beforeEach(() => {
    h.impl = async () => ({ emailSent: true, pushSent: true });
  });

  it('resolves normally when the notify call succeeds', async () => {
    await expect(
      notifyBlockedMinorBestEffort({ email: 'a@example.com' }, 'kid1', new Date()),
    ).resolves.toBeUndefined();
  });

  it('swallows a thrown error from notifyBlockedMinor and logs it — the erasure must survive', async () => {
    h.impl = async () => {
      throw new Error('mailer exploded');
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // THE pin: if this rejects, the erasure calling it aborts mid-way —
    // exactly the state the child was left BLOCKED but every later step
    // (disabling Auth, the adminAlert) never ran.
    await expect(
      notifyBlockedMinorBestEffort({ email: 'a@example.com' }, 'kid1', new Date()),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, meta] = errorSpy.mock.calls[0];
    expect(message).toBe('[erasure] failed to notify blocked minor');
    expect((meta as { childUid: string }).childUid).toBe('kid1');

    errorSpy.mockRestore();
  });
});
