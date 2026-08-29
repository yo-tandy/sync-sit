import { describe, it, expect, beforeEach, vi } from 'vitest';

// Unit pins for the two `doSubmitEndorsement` fixes in issue #357.
//
// GATE ORDER (item 1): the relationship gate must refuse BEFORE the doer
// existence/enrollment check, so a caller cannot tell "this uid is not an
// enrolled doer" from "it is, but you never hired them".
//
// DEDUP WIRING (item 2), following the `sendRateLimitTx` precedent: the dedup
// READ and the endorsement WRITE must happen inside a single runTransaction
// (tx.get / tx.set — never a bare query.get() or ref.set()), and the duplicate
// branch must refuse WITHOUT writing. Why unit rather than emulator: two
// callable invocations racing on the same (family, doer) pair cannot be raced
// deterministically from the integration suite — the functions emulator is
// free to serialize them, in which case the old best-effort query-then-set()
// passes too. Exactness under real contention is enforced by construction
// (Firestore serializes transactions contending on the read set), so what
// needs pinning is the wiring.

const ENROLLED_DOER = {
  status: 'active',
  profiles: { doer: { enrollmentComplete: true } },
};

const h = vi.hoisted(() => ({
  task: null as unknown,
  doerData: {} as unknown,
  doerExists: true,
  dupDocs: [] as unknown[],
  runTransactionCalls: 0,
  txGets: [] as { kind: string; filters: [string, string][] }[],
  txSets: [] as { id: string; data: Record<string, unknown> }[],
  directQueryGets: 0,
  directSets: 0,
  auditCalls: 0,
  findTaskCalls: 0,
  doerReads: 0,
}));

/** A query builder that records its equality filters and counts bare .get(). */
function fakeQuery(filters: [string, string][] = []) {
  const q: Record<string, unknown> = {
    __kind: 'query',
    __filters: filters,
    where: (field: string, _op: string, value: string) =>
      fakeQuery([...filters, [field, value]]),
    limit: () => q,
    get: async () => {
      // The bug this exists to prevent: reading the dedup set OUTSIDE the
      // transaction.
      h.directQueryGets += 1;
      return { empty: h.dupDocs.length === 0, docs: h.dupDocs };
    },
  };
  return q;
}

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => ({
      doc: (id?: string) => ({
        id: id ?? 'auto-generated-id',
        get: async () => {
          if (name === 'families') {
            return { exists: true, data: () => ({ verification: { isFullyVerified: true } }) };
          }
          h.doerReads += 1;
          return { exists: h.doerExists, data: () => h.doerData };
        },
        set: async () => {
          h.directSets += 1;
        },
      }),
      where: (field: string, _op: string, value: string) => fakeQuery([[field, value]]),
    }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      h.runTransactionCalls += 1;
      const tx = {
        get: async (target: { __kind?: string; __filters?: [string, string][] }) => {
          h.txGets.push({ kind: target.__kind ?? 'doc', filters: target.__filters ?? [] });
          return { empty: h.dupDocs.length === 0, docs: h.dupDocs };
        },
        set: (ref: { id: string }, data: Record<string, unknown>) => {
          h.txSets.push({ id: ref.id, data });
        },
      };
      return fn(tx);
    },
  },
}));

vi.mock('firebase-functions/v2/https', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase-functions/v2/https')>()),
  onCall: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('../../config/cors.js', () => ({ getCorsOrigin: () => [] }));
vi.mock('../../admin/writeAuditLog.js', () => ({
  writeUserActivity: async () => {
    h.auditCalls += 1;
  },
}));
vi.mock('../notify.js', () => ({
  notifyDoSafely: async (_label: string, fn: () => Promise<void>) => fn(),
  sendDoNotificationSafely: async () => {},
}));
vi.mock('../offerAccess.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../offerAccess.js')>()),
  loadActiveCaller: async () => ({
    status: 'active',
    firstName: 'Marie',
    lastName: 'Dupont',
    profiles: { parent: { familyId: 'fam-1' } },
  }),
}));
vi.mock('../endorsementAccess.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../endorsementAccess.js')>()),
  findQualifyingCompletedTask: async () => {
    h.findTaskCalls += 1;
    return h.task;
  },
}));

import { doSubmitEndorsement } from '../submitEndorsement.js';

const handler = doSubmitEndorsement as unknown as (req: unknown) => Promise<unknown>;

const REQUEST = {
  auth: { uid: 'parent-1' },
  data: {
    doerUserId: 'doer-1',
    referenceText: 'Assembled two PAX wardrobes in an afternoon and cleaned up after.',
    refName: 'Marie',
  },
};

beforeEach(() => {
  h.task = { taskId: 'task-1', title: 'Assemble PAX', category: 'ikea' };
  h.doerData = ENROLLED_DOER;
  h.doerExists = true;
  h.dupDocs = [];
  h.runTransactionCalls = 0;
  h.txGets = [];
  h.txSets = [];
  h.directQueryGets = 0;
  h.directSets = 0;
  h.auditCalls = 0;
  h.findTaskCalls = 0;
  h.doerReads = 0;
});

describe('doSubmitEndorsement gate order (the enumeration oracle)', () => {
  it('refuses no_completed_task for a uid that is not an account at all', async () => {
    // Under the old order this returned `not-found`, which told the caller
    // the uid names no enrolled doer — for any uid they cared to try.
    h.task = null;
    h.doerExists = false;
    h.doerData = {};
    await expect(handler(REQUEST)).rejects.toMatchObject({
      code: 'permission-denied',
      details: { reason: 'no_completed_task' },
    });
  });

  it('refuses a real enrolled doer this family never hired the SAME way', async () => {
    h.task = null;
    await expect(handler(REQUEST)).rejects.toMatchObject({
      code: 'permission-denied',
      details: { reason: 'no_completed_task' },
    });
  });

  it('does not even READ the doer doc until the relationship gate has passed', async () => {
    // The strongest form of the pin: with no qualifying task the callable
    // learns nothing about the named account, so it can say nothing about it.
    h.task = null;
    await expect(handler(REQUEST)).rejects.toThrow();
    expect(h.findTaskCalls).toBe(1);
    expect(h.doerReads).toBe(0);
  });

  it('still refuses not-found for an unenrolled doer the family DID hire', async () => {
    // Reordered, not removed: past the relationship gate the caller already
    // knows this account exists, so naming the real problem leaks nothing.
    h.doerData = { status: 'active', profiles: { doer: { enrollmentComplete: false } } };
    await expect(handler(REQUEST)).rejects.toMatchObject({ code: 'not-found' });
    expect(h.doerReads).toBe(1);
  });
});

describe('doSubmitEndorsement dedup wiring', () => {
  it('reads the dedup set and writes the endorsement inside ONE transaction', async () => {
    await handler(REQUEST);
    expect(h.runTransactionCalls).toBe(1);
    expect(h.txGets).toHaveLength(1);
    // The (appSource, doer, family) triple — the one-per-family key.
    expect(h.txGets[0].kind).toBe('query');
    expect(h.txGets[0].filters).toEqual([
      ['appSource', 'do'],
      ['doerUserId', 'doer-1'],
      ['submittedByFamilyId', 'fam-1'],
    ]);
    expect(h.txSets).toHaveLength(1);
    expect(h.txSets[0].data).toMatchObject({
      doerUserId: 'doer-1',
      appSource: 'do',
      type: 'family_submitted',
      status: 'private',
      submittedByUserId: 'parent-1',
      submittedByFamilyId: 'fam-1',
      category: 'ikea',
    });
  });

  it('never reads the dedup set, or writes the doc, outside the transaction', async () => {
    // The old shape: `await query.get()` then `await refDoc.set()`. Either one
    // outside the transaction reopens the co-parent race.
    await handler(REQUEST);
    expect(h.directQueryGets).toBe(0);
    expect(h.directSets).toBe(0);
  });

  it('refuses a duplicate with already_endorsed and writes NOTHING', async () => {
    h.dupDocs = [{ id: 'existing' }];
    await expect(handler(REQUEST)).rejects.toMatchObject({
      code: 'already-exists',
      details: { reason: 'already_endorsed' },
    });
    expect(h.txSets).toEqual([]);
    expect(h.directSets).toBe(0);
    // A refused submission must not leave an audit trail claiming it happened.
    expect(h.auditCalls).toBe(0);
  });

  it('keeps the AUTO id — the doc identity every existing reader depends on', async () => {
    // Deliberately not a deterministic `${familyId}_${doerUserId}`: the shared
    // `references` collection allows client creates at arbitrary ids, so a
    // predictable address would be squattable, and the PR11 docs already in
    // the database carry auto-ids.
    await handler(REQUEST);
    expect(h.txSets[0].id).toBe('auto-generated-id');
    expect(h.txSets[0].data.referenceId).toBe('auto-generated-id');
  });
});
