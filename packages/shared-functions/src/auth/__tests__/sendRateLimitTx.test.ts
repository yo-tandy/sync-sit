import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for the transactional counter registration (PR #180 review): the
// get/decide/set must run inside a single-doc runTransaction (reads via
// tx.get, writes via tx.set — never ref.get/ref.set), and the capped branch
// must return false WITHOUT writing. The exactness of the cap under
// concurrency is enforced by construction (Firestore serializes transactions
// contending on the doc) — the emulator suite cannot deterministically race
// it, so these pins lock the transaction wiring instead.

const h = vi.hoisted(() => ({
  txData: undefined as Record<string, unknown> | undefined,
  txGets: [] as string[],
  txSets: [] as { id: string; data: Record<string, unknown> }[],
  runTransactionCalls: 0,
  directGets: 0,
  directSets: 0,
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (_collection: string) => ({
      doc: (id: string) => ({
        id,
        get: async () => {
          h.directGets += 1;
          return { exists: false, data: () => undefined };
        },
        set: async () => {
          h.directSets += 1;
        },
      }),
    }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      h.runTransactionCalls += 1;
      const tx = {
        get: async (ref: { id: string }) => {
          h.txGets.push(ref.id);
          return { exists: h.txData !== undefined, data: () => h.txData };
        },
        set: (ref: { id: string }, data: Record<string, unknown>) => {
          h.txSets.push({ id: ref.id, data });
        },
      };
      return fn(tx);
    },
  },
}));

import { registerVerificationSend, registerBypassSend, DAILY_SEND_CAP, BYPASS_SEND_CAP } from '../sendRateLimit.js';

beforeEach(() => {
  h.txData = undefined;
  h.txGets = [];
  h.txSets = [];
  h.runTransactionCalls = 0;
  h.directGets = 0;
  h.directSets = 0;
});

describe('registerVerificationSend (transactional)', () => {
  it('runs inside runTransaction, reading and writing through the tx only', async () => {
    const allowed = await registerVerificationSend('addr@ejm.org');
    expect(allowed).toBe(true);
    expect(h.runTransactionCalls).toBe(1);
    expect(h.txGets).toEqual(['addr@ejm.org']);
    expect(h.txSets).toEqual([
      {
        id: 'addr@ejm.org',
        data: {
          key: 'addr@ejm.org',
          kind: 'address',
          count: 1,
          windowStart: expect.any(Date),
        },
      },
    ]);
    // Never the non-transactional doc handle.
    expect(h.directGets).toBe(0);
    expect(h.directSets).toBe(0);
  });

  it('increments an in-window counter through tx.set', async () => {
    h.txData = { count: 4, windowStart: new Date(Date.now() - 1000) };
    const allowed = await registerVerificationSend('addr@ejm.org');
    expect(allowed).toBe(true);
    expect(h.txSets[0].data.count).toBe(5);
  });

  it('returns false at the cap with NO write of any kind', async () => {
    h.txData = { count: DAILY_SEND_CAP, windowStart: new Date(Date.now() - 1000) };
    const allowed = await registerVerificationSend('addr@ejm.org');
    expect(allowed).toBe(false);
    expect(h.txSets).toEqual([]);
    expect(h.directSets).toBe(0);
  });
});

describe('registerBypassSend (transactional)', () => {
  it('uses the same transactional path with the bypass kind and cap', async () => {
    const allowed = await registerBypassSend('some-uid');
    expect(allowed).toBe(true);
    expect(h.runTransactionCalls).toBe(1);
    expect(h.txSets[0].data.kind).toBe('bypass');
  });

  it('returns false at the bypass cap without writing', async () => {
    h.txData = { count: BYPASS_SEND_CAP, windowStart: new Date(Date.now() - 1000) };
    const allowed = await registerBypassSend('some-uid');
    expect(allowed).toBe(false);
    expect(h.txSets).toEqual([]);
  });
});
