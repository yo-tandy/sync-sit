import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The partial-erasure alarm (issue #368 review round 6).
 *
 * The NEGATIVE half — a clean erasure raising nothing — is pinned against the
 * emulator on both callables. The POSITIVE half was not pinned anywhere: a
 * cascade failing on demand is not something the emulator can be made to
 * stage, so `partial_user_erasure` had two writers and no test that had ever
 * seen one fire. That includes `selfDeleted`, which exists precisely so an
 * operator can tell the two paths apart in `adminAlerts`.
 *
 * Mocking the write makes the counters an INPUT — the same move
 * `account/__tests__/guardianNotifyCounts.test.ts` makes for the transports.
 * It borrows no assumption from the code under test, which is the decision of
 * WHEN to fire and WHAT to record.
 */

const h = vi.hoisted(() => ({ alerts: [] as Record<string, unknown>[] }));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'adminAlerts') {
        return {
          add: async (doc: Record<string, unknown>) => {
            h.alerts.push(doc);
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  },
}));

import { raisePartialErasureAlert } from '../partialErasureAlert.js';

const NOW = new Date('2026-08-30T10:00:00Z');

function erased(cascadeErrors: number, claimReleaseErrors: number) {
  return { studyErasure: { cascadeErrors }, claimReleaseErrors, now: NOW };
}

describe('raisePartialErasureAlert', () => {
  beforeEach(() => {
    h.alerts.length = 0;
  });

  it('writes nothing, and returns 0, when the erasure was clean', async () => {
    expect(await raisePartialErasureAlert('u1', erased(0, 0), false)).toBe(0);
    expect(h.alerts).toHaveLength(0);
  });

  it.each([
    ['a study cascade alone', 2, 0, 2],
    ['a sit claim release alone', 0, 3, 3],
    ['both', 2, 3, 5],
  ])('fires on %s and records each count separately', async (_l, cascade, claims, total) => {
    // Recorded separately, not just as a total: the two failures point at
    // different collections, and an operator opening the alert needs to know
    // which one to go and look at.
    expect(await raisePartialErasureAlert('u1', erased(cascade, claims), false)).toBe(total);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toEqual({
      type: 'partial_user_erasure',
      createdAt: NOW,
      data: {
        targetUserId: 'u1',
        studySessionCascadeErrors: cascade,
        claimReleaseErrors: claims,
        selfDeleted: false,
      },
    });
  });

  it('marks a self-delete, so an operator can tell the two paths apart', async () => {
    // The admin path has a human who can be asked what happened. This one has
    // nobody, and the account is already unrecoverable — the distinction is
    // the whole reason the flag exists.
    await raisePartialErasureAlert('kid1', erased(1, 0), true);
    expect((h.alerts[0].data as Record<string, unknown>).selfDeleted).toBe(true);
    expect((h.alerts[0].data as Record<string, unknown>).targetUserId).toBe('kid1');
  });

  it('carries the erasure\'s own timestamp, not a fresh one', async () => {
    // `erased.now` is the instant the erasure ran. An alert stamped at write
    // time would drift from the audit entry it has to be correlated with.
    await raisePartialErasureAlert('u1', erased(0, 1), false);
    expect(h.alerts[0].createdAt).toBe(NOW);
  });
});
