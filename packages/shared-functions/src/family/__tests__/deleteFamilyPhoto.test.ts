import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for every validation/authz branch that fires BEFORE the
// (mocked) Admin SDK Storage delete and Firestore update — mirrors
// createFamilyPhotoUploadUrl.test.ts. The integration suite
// (tests/integration/family/delete-family-photo.test.ts) covers the same
// branches against the REAL emulator (Firestore membership lookup and an
// actual object delete included).

const h = vi.hoisted(() => ({
  callerData: undefined as Record<string, unknown> | undefined,
  familyData: undefined as Record<string, unknown> | undefined,
  familyUpdates: [] as Record<string, unknown>[],
  deleteCalls: [] as { path: string; options: Record<string, unknown> }[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => ({
      doc: () => ({
        get: async () => {
          if (name === 'users') {
            return { exists: h.callerData !== undefined, data: () => h.callerData };
          }
          if (name === 'families') {
            return { exists: h.familyData !== undefined, data: () => h.familyData };
          }
          throw new Error(`unexpected collection ${name}`);
        },
        update: async (data: Record<string, unknown>) => {
          h.familyUpdates.push(data);
        },
      }),
    }),
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path: string) => ({
        delete: async (options: Record<string, unknown>) => {
          h.deleteCalls.push({ path, options });
        },
      }),
    }),
  }),
}));

import { deleteFamilyPhoto } from '../deleteFamilyPhoto.js';

function call(data: Record<string, unknown>, uid = 'parent1') {
  return deleteFamilyPhoto.run({
    auth: uid ? { uid } : undefined,
    data,
    rawRequest: {},
  } as never);
}

const VALID = { familyId: 'fam1', objectPath: 'family-photos/fam1/photo1.jpg' };

beforeEach(() => {
  h.callerData = { profiles: { parent: { familyId: 'fam1' } } };
  h.familyData = { familyId: 'fam1', familyName: 'Test' };
  h.familyUpdates.length = 0;
  h.deleteCalls.length = 0;
});

describe('deleteFamilyPhoto', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      deleteFamilyPhoto.run({ auth: undefined, data: VALID, rawRequest: {} } as never),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a missing/empty familyId', async () => {
    await expect(call({ ...VALID, familyId: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ ...VALID, familyId: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a missing/empty objectPath', async () => {
    await expect(call({ ...VALID, objectPath: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ ...VALID, objectPath: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Path guard — no traversal, no other family's path ──

  it('rejects an objectPath under a DIFFERENT family than the requested familyId', async () => {
    await expect(
      call({ ...VALID, objectPath: 'family-photos/other-fam/photo1.jpg' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects an objectPath with no family-photos prefix match at all', async () => {
    await expect(
      call({ ...VALID, objectPath: 'profile-photos/fam1/photo1.jpg' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a nested sub-path under the family prefix', async () => {
    await expect(
      call({ ...VALID, objectPath: 'family-photos/fam1/sub/photo1.jpg' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a bare prefix with no filename', async () => {
    await expect(call({ ...VALID, objectPath: 'family-photos/fam1/' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects a traversal attempt embedded in the remainder', async () => {
    await expect(
      call({ ...VALID, objectPath: 'family-photos/fam1/../fam2/photo1.jpg' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // ── Membership gate (shared with createFamilyPhotoUploadUrl) ──

  it('rejects a non-member (permission-denied)', async () => {
    h.callerData = { profiles: { parent: { familyId: 'other-fam' } } };
    await expect(call(VALID)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a caller with no user doc', async () => {
    h.callerData = undefined;
    await expect(call(VALID)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('allows an admin regardless of family membership', async () => {
    h.callerData = { isAdmin: true };
    const result = await call({
      familyId: 'someone-elses-family',
      objectPath: 'family-photos/someone-elses-family/photo1.jpg',
    });
    expect(result).toEqual({ success: true });
  });

  // ── Delete + photoUrl cleanup ──

  it('deletes the object via the Admin SDK, idempotently (ignoreNotFound)', async () => {
    const result = await call(VALID);
    expect(result).toEqual({ success: true });
    expect(h.deleteCalls).toEqual([
      { path: 'family-photos/fam1/photo1.jpg', options: { ignoreNotFound: true } },
    ]);
  });

  it("clears the family doc's photoUrl when it points at the deleted object", async () => {
    h.familyData = {
      familyId: 'fam1',
      photoUrl:
        'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/family-photos%2Ffam1%2Fphoto1.jpg?alt=media&token=abc',
    };
    await call(VALID);
    expect(h.familyUpdates).toEqual([{ photoUrl: null }]);
  });

  it('does NOT touch photoUrl when it points at a DIFFERENT object', async () => {
    h.familyData = {
      familyId: 'fam1',
      photoUrl:
        'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/family-photos%2Ffam1%2Fother.jpg?alt=media&token=abc',
    };
    await call(VALID);
    expect(h.familyUpdates).toEqual([]);
  });

  it('does NOT touch photoUrl when the family doc has none', async () => {
    h.familyData = { familyId: 'fam1' };
    await call(VALID);
    expect(h.familyUpdates).toEqual([]);
  });
});
