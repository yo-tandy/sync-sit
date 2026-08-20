import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for addProfileToUser's TWO base-field maps (PR #206 review).
// fillBaseFields is set-once identity (write only into an empty field);
// setBaseFields is unconditional and exists for data the user just entered.
// The contract that is invisible from every call site is the ORDERING: the
// setBaseFields loop runs after the fillBaseFields loop, so on a key present
// in both, setBaseFields wins. These assertions hold whoever refactors the
// two loops.

const h = vi.hoisted(() => ({
  existing: {} as Record<string, unknown>,
  update: undefined as Record<string, unknown> | undefined,
  audits: [] as { uid: string; action: string }[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: () => ({ doc: (id: string) => ({ id }) }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: async () => ({ exists: true, data: () => h.existing }),
        update: (_ref: unknown, data: Record<string, unknown>) => {
          h.update = data;
        },
      };
      return fn(tx);
    },
  },
}));

vi.mock('../../admin/writeAuditLog.js', () => ({
  writeUserActivity: async (uid: string, action: string) => {
    h.audits.push({ uid, action });
  },
}));

const { addProfileToUser } = await import('../addProfileToUser.js');

function call(over: Record<string, unknown> = {}) {
  return addProfileToUser({
    uid: 'u1',
    profileKey: 'tutor',
    profileData: { enrollmentComplete: true },
    auditAction: 'tutor.profile_added',
    ...over,
  });
}

beforeEach(() => {
  h.existing = { status: 'active', profiles: {} };
  h.update = undefined;
  h.audits = [];
});

describe('addProfileToUser base-field maps', () => {
  it('fillBaseFields writes into an EMPTY field and leaves a populated one alone', async () => {
    h.existing = { status: 'active', profiles: {}, firstName: '', lastName: 'Bernard' };
    await call({ fillBaseFields: { firstName: 'Lea', lastName: 'Typo' } });
    expect(h.update!.firstName).toBe('Lea');
    expect(h.update).not.toHaveProperty('lastName');
  });

  it('setBaseFields OVERWRITES a populated field', async () => {
    h.existing = { status: 'active', profiles: {}, contactEmail: 'old@x.com' };
    await call({ setBaseFields: { contactEmail: 'new@x.com' } });
    expect(h.update!.contactEmail).toBe('new@x.com');
  });

  it('setBaseFields skips undefined, so "not supplied" leaves the field alone', async () => {
    h.existing = { status: 'active', profiles: {}, contactPhone: '+33600000000' };
    await call({ setBaseFields: { contactPhone: undefined, whatsapp: undefined } });
    expect(h.update).not.toHaveProperty('contactPhone');
    expect(h.update).not.toHaveProperty('whatsapp');
  });

  it('setBaseFields wins over fillBaseFields on the same key (loop ORDER is load-bearing)', async () => {
    h.existing = { status: 'active', profiles: {}, contactEmail: '' };
    await call({
      fillBaseFields: { contactEmail: 'filled@x.com' },
      setBaseFields: { contactEmail: 'typed@x.com' },
    });
    expect(h.update!.contactEmail).toBe('typed@x.com');
  });

  it('writes neither map when neither is supplied', async () => {
    h.existing = { status: 'active', profiles: {}, contactEmail: 'old@x.com' };
    await call();
    expect(Object.keys(h.update!).sort()).toEqual(['profiles.tutor', 'updatedAt']);
  });
});
