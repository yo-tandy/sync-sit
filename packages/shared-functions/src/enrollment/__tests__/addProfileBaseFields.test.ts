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

// Issue #279 / PR #284: the orphan-parent re-attach carve-out in
// assertAddable, pinned at the unit level (the emulator suite covers it
// end-to-end; this holds whoever refactors the gate).
describe('assertAddable orphan-parent carve-out (issue #279)', () => {
  it('re-attaches a parent profile WITHOUT a familyId, merging field-by-field', async () => {
    h.existing = {
      status: 'active',
      profiles: { parent: { enrollmentComplete: true, phone: '+33 611111111' } },
    };
    await call({ profileKey: 'parent', profileData: { enrollmentComplete: true, familyId: 'fam-new' } });
    // Field-by-field merge: dotted paths, so the surviving phone is untouched.
    expect(h.update!['profiles.parent.familyId']).toBe('fam-new');
    expect(h.update!['profiles.parent']).toBeUndefined();
  });

  it('still rejects a parent profile WITH a familyId', async () => {
    h.existing = {
      status: 'active',
      profiles: { parent: { enrollmentComplete: true, familyId: 'fam-old' } },
    };
    await expect(
      call({ profileKey: 'parent', profileData: { enrollmentComplete: true, familyId: 'fam-new' } }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('a legacy Plan C doc (ROOT familyId, none on the profile) is NOT an orphan', async () => {
    // Reading it as one would let an active member of family X accept an
    // invite to family Y and hold both memberships (round-2 review).
    h.existing = {
      status: 'active',
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true } },
    };
    await expect(
      call({ profileKey: 'parent', profileData: { enrollmentComplete: true, familyId: 'fam-new' } }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('legacy ROOT membership with NO parent profile also rejects a parent add (round 7)', async () => {
    // Serving it as a plain add would write a second family beside a live
    // root membership -- dual membership with no removal event.
    h.existing = { status: 'active', familyId: 'fam-legacy', profiles: {} };
    await expect(
      call({ profileKey: 'parent', profileData: { enrollmentComplete: true, familyId: 'fam-new' } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('provider profiles keep the strict check (no orphan state exists for them)', async () => {
    h.existing = { status: 'active', profiles: { tutor: { enrollmentComplete: true } } };
    await expect(
      call({ profileKey: 'tutor' }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});
