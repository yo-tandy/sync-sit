import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `eraseUserAccount`'s own wrapping around `guardAgainstLastAdmin` +
 * `performErasure` (issue #421, option 2b, review round 2).
 *
 * The FIRST version of this guard flipped `isAdmin: false` on the target as
 * its very first act. If `performErasure` then threw on any LATER step --
 * appointments, schedule, references, sync-do, sync-study, any of it -- the
 * target was left silently demoted and NOT deleted, and neither `deleteUser`
 * nor `deleteMyAccount` caught anything to notice. This file pins the fix:
 * a non-destructive `erasureStartedAt` marker, cleared on failure, with an
 * alert written before the error is rethrown.
 *
 * Pinned here rather than in the emulator suite for the reason every other
 * `__tests__` file beside this one gives: staging a GENUINE mid-pipeline
 * throw against a live Firestore/Auth would mean sabotaging a real erasure
 * step from outside, which the emulator has no hook for. Mocking
 * `../performErasure.js` makes "the erasure throws" an INPUT instead.
 *
 * The count-exclusion half (a doc already carrying `erasureStartedAt` is not
 * a real alternative admin) is pinned here too, via the SAME transaction
 * mock, since it lives in the same `guardAgainstLastAdmin` this suite already
 * has to model.
 *
 * The happy path (guard passes, `performErasure` succeeds, no marker left
 * behind) is already covered end-to-end by
 * `tests/integration/admin/last-admin.test.ts` against the real emulator;
 * this file exists for the failure path that emulator cannot stage.
 */

const h = vi.hoisted(() => ({
  /** `users/{uid}` docs, keyed by uid. */
  userDocs: new Map<string, Record<string, unknown> | undefined>(),
  /** What the active-admin count QUERY returns inside the transaction. */
  activeAdminQueryResults: [] as { id: string; data: Record<string, unknown> }[],
  /** Direct (non-transactional) `userRef.update()` calls — the cleanup path. */
  directUpdates: [] as { id: string; data: Record<string, unknown> }[],
  /** `tx.update()` calls — the marker write inside the guard's transaction. */
  txUpdates: [] as { id: string; data: Record<string, unknown> }[],
  /** `adminAlerts` docs written. */
  alerts: [] as Record<string, unknown>[],
  runTransactionCalls: 0,
  /** The mocked `performErasure` — throws or resolves per test. */
  performErasureImpl: (async () => ({ ok: true })) as (
    ...args: unknown[]
  ) => Promise<unknown>,
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'users') {
        return {
          doc: (id: string) => ({
            id,
            get: async () => ({
              exists: h.userDocs.has(id),
              data: () => h.userDocs.get(id),
            }),
            update: async (data: Record<string, unknown>) => {
              h.directUpdates.push({ id, data });
            },
          }),
          where: () => ({
            // Two chained `.where()` calls in `guardAgainstLastAdmin` — the
            // object needs to survive both, and be recognisable to the tx
            // mock's `get` as "this is the active-admin count query", not a
            // doc ref.
            where: () => ({ __activeAdminQuery: true }),
          }),
        };
      }
      if (name === 'adminAlerts') {
        return {
          add: async (data: Record<string, unknown>) => {
            h.alerts.push(data);
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.runTransactionCalls += 1;
      const tx = {
        get: async (refOrQuery: { id?: string; __activeAdminQuery?: boolean }) => {
          if (refOrQuery.__activeAdminQuery) {
            return { docs: h.activeAdminQueryResults.map((d) => ({ data: () => d.data })) };
          }
          const id = refOrQuery.id!;
          return { exists: h.userDocs.has(id), data: () => h.userDocs.get(id) };
        },
        update: (ref: { id: string }, data: Record<string, unknown>) => {
          h.txUpdates.push({ id: ref.id, data });
        },
      };
      return fn(tx);
    },
  },
  adminAuth: {},
}));

vi.mock('../performErasure.js', () => ({
  performErasure: (...args: unknown[]) => h.performErasureImpl(...args),
}));

import { eraseUserAccount } from '../deleteUser.js';

const ADMIN_A = {
  uid: 'admin-a',
  isAdmin: true,
  status: 'active',
  email: 'a@syncsit.test',
};
const ADMIN_B_DOC = { isAdmin: true, status: 'active' };

beforeEach(() => {
  h.userDocs = new Map([['admin-a', { ...ADMIN_A }]]);
  h.activeAdminQueryResults = [
    { id: 'admin-a', data: { isAdmin: true, status: 'active' } },
    { id: 'admin-b', data: ADMIN_B_DOC },
  ];
  h.directUpdates = [];
  h.txUpdates = [];
  h.alerts = [];
  h.runTransactionCalls = 0;
  h.performErasureImpl = async () => ({ ok: true });
});

describe('eraseUserAccount — marker cleanup and alert on a failure after the guard', () => {
  it('writes the marker, and on a thrown erasure step clears it, alerts, and rethrows', async () => {
    const boom = new Error('references step exploded');
    h.performErasureImpl = async () => {
      throw boom;
    };

    await expect(eraseUserAccount('admin-a', 'admin-a')).rejects.toBe(boom);

    // The guard wrote the marker inside its OWN transaction, not a direct
    // update -- that write is what races correctly.
    expect(h.txUpdates).toEqual([{ id: 'admin-a', data: { erasureStartedAt: expect.any(Date) } }]);

    // The failure path clears it with a DIRECT update (FieldValue.delete()),
    // outside the transaction -- the target was never actually erased.
    expect(h.directUpdates).toHaveLength(1);
    expect(h.directUpdates[0].id).toBe('admin-a');
    expect(Object.keys(h.directUpdates[0].data)).toEqual(['erasureStartedAt']);
    // FieldValue.delete() sentinels don't stringify usefully; presence of
    // the key with SOME value from the real FieldValue module is the pin.
    expect(h.directUpdates[0].data.erasureStartedAt).toBeDefined();

    // Loud, not silent: an alert names the target and why.
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toMatchObject({
      type: 'partial_user_erasure',
      data: {
        targetUserId: 'admin-a',
        reason: 'admin_erasure_threw_after_guard',
        selfDeleted: true,
      },
    });
  });

  it('selfDeleted is false when an ADMIN erases a DIFFERENT admin', async () => {
    h.performErasureImpl = async () => {
      throw new Error('boom');
    };
    await expect(eraseUserAccount('admin-a', 'someone-else-uid')).rejects.toThrow('boom');
    expect(h.alerts[0]).toMatchObject({ data: { selfDeleted: false } });
  });

  it('a non-admin target throwing mid-erasure raises NO alert (no marker was ever written)', async () => {
    h.userDocs.set('member-1', { isAdmin: false, status: 'active', email: 'm@syncsit.test' });
    h.performErasureImpl = async () => {
      throw new Error('boom');
    };

    await expect(eraseUserAccount('member-1', 'admin-a')).rejects.toThrow('boom');

    expect(h.txUpdates).toEqual([]);
    expect(h.directUpdates).toEqual([]);
    expect(h.alerts).toEqual([]);
  });

  it('a successful erasure leaves the marker written but no cleanup call and no failure alert', async () => {
    // The happy path never reaches the catch block at all.
    const result = await eraseUserAccount('admin-a', 'admin-a');
    expect(result).toEqual({ ok: true });
    expect(h.txUpdates).toEqual([{ id: 'admin-a', data: { erasureStartedAt: expect.any(Date) } }]);
    expect(h.directUpdates).toEqual([]);
    expect(h.alerts).toEqual([]);
  });
});

describe('guardAgainstLastAdmin — the count excludes docs already mid-erasure', () => {
  it('refuses when every OTHER active admin already carries erasureStartedAt', async () => {
    h.activeAdminQueryResults = [
      { id: 'admin-a', data: { isAdmin: true, status: 'active' } },
      // The only other "active" admin is already being erased by a
      // concurrent, still-in-flight call — not a real alternative.
      { id: 'admin-b', data: { isAdmin: true, status: 'active', erasureStartedAt: new Date() } },
    ];

    await expect(eraseUserAccount('admin-a', 'admin-a')).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { code: 'admin/last-admin' },
    });

    // Refused BEFORE any marker write and before `performErasure` ever runs.
    expect(h.txUpdates).toEqual([]);
    expect(h.performErasureImpl).toBeDefined(); // sanity: mock still in place
  });

  it('a genuinely unmarked second admin is enough to pass', async () => {
    h.activeAdminQueryResults = [
      { id: 'admin-a', data: { isAdmin: true, status: 'active' } },
      { id: 'admin-b', data: { isAdmin: true, status: 'active' } },
    ];
    const result = await eraseUserAccount('admin-a', 'admin-a');
    expect(result).toEqual({ ok: true });
    expect(h.txUpdates).toEqual([{ id: 'admin-a', data: { erasureStartedAt: expect.any(Date) } }]);
  });
});
