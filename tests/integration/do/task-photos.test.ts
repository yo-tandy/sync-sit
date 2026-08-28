import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
  getBucket,
  clearStoragePrefix,
  parisDateFromNow,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// The §7.4 photo pins on the WRITE paths (doPostTask AND doUpdateTask must
// refuse a photoId under another uploader's prefix — the anti-hijack check
// on both, §14) and the two signing callables' audiences. Final objects are
// seeded directly under do-photos/ via the Admin SDK (bypasses rules and
// the trigger — deterministic); the strip round trip itself is
// strip-task-photo.test.ts.

const DOER_UID = 'doer-photos-1';

/** Seed a stripped photo object under a user's final prefix. */
async function seedPhoto(uid: string, photoId: string) {
  await getBucket().file(`do-photos/${uid}/${photoId}`).save(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]), {
    resumable: false,
    metadata: { contentType: 'image/jpeg' },
  });
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    category: 'ikea',
    subCategory: 'ikea_assembly',
    title: 'Assemble the new desk',
    description: 'Flat-pack desk, all tools provided.',
    photos: [],
    timing: 'ongoing',
    startDate: parisDateFromNow(1),
    cadence: { kind: 'custom', note: 'Any weekday evening' },
    adultPresent: 'yes',
    transportNeeded: false,
    ...overrides,
  };
}

describe('task photo pipeline — write-path pins and signing callables', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent2Token: string;
  let doerToken: string;
  let outsiderToken: string; // babysitter — authenticated, not a doer, not the family

  beforeAll(async () => {
    await clearAll();
    await clearStoragePrefix('do-photos/');
    await clearStoragePrefix('do-uploads/');
    seed = await seedTestData();
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016', city: 'Paris',
    });
    await getAdminAuth().createUser({ uid: DOER_UID, email: 'doer.photos@ejm.org' });
    await getDb().collection('users').doc(DOER_UID).set({
      uid: DOER_UID, email: 'doer.photos@ejm.org', status: 'active',
      firstName: 'Pia', lastName: 'Photo', dateOfBirth: new Date('2008-01-01'),
      profiles: {
        doer: {
          enrollmentComplete: true, notifyNewTasks: false,
          categories: ['ikea'], bio: null, defaultRate: null,
          hasCar: false, hasBike: false,
        },
      },
      notifPrefs: {}, fcmTokens: [], createdAt: new Date(), updatedAt: new Date(),
    });
    parent1Token = await getIdToken(seed.parent1.uid);
    parent2Token = await getIdToken(seed.parent2.uid);
    doerToken = await getIdToken(DOER_UID);
    outsiderToken = await getIdToken(seed.babysitter1.uid);

    // Stripped photos on file: one per parent, plus one for the doer (to
    // prove uid-prefix isolation, not existence, is what gates).
    await seedPhoto(seed.parent1.uid, 'p1-photo-1');
    await seedPhoto(seed.parent1.uid, 'p1-photo-2');
    await seedPhoto(seed.parent2.uid, 'p2-photo-1');
    await seedPhoto(DOER_UID, 'doer-photo-1');
  });

  afterAll(async () => {
    await clearStoragePrefix('do-photos/');
    await clearStoragePrefix('do-uploads/');
    await clearAll();
  });

  describe('doPostTask photo pins (§7.4 anti-hijack)', () => {
    it('accepts the caller’s own stripped photos and stores the {uid, photoId} pairs', async () => {
      const { taskId } = await callFunction<{ taskId: string }>('doPostTask', payload({
        photos: [
          { uid: seed.parent1.uid, photoId: 'p1-photo-1' },
          { uid: seed.parent1.uid, photoId: 'p1-photo-2' },
        ],
      }), parent1Token);
      const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
      expect(task.photos).toEqual([
        { uid: seed.parent1.uid, photoId: 'p1-photo-1' },
        { uid: seed.parent1.uid, photoId: 'p1-photo-2' },
      ]);
      await getDb().collection('doTasks').doc(taskId).delete();
    });

    it('REFUSES a pair under another uploader’s prefix — even one that exists (the hijack pin)', async () => {
      await expect(callFunction('doPostTask', payload({
        photos: [{ uid: DOER_UID, photoId: 'doer-photo-1' }],
      }), parent1Token)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { reason: 'photo_not_owned' },
      });
      // The co-parent's photo is JUST as refused at post time: doPostTask
      // verifies against the CALLER's prefix (co-parent photos enter via
      // doUpdateTask, by the co-parent).
      await expect(callFunction('doPostTask', payload({
        photos: [{ uid: seed.parent2.uid, photoId: 'p2-photo-1' }],
      }), parent1Token)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { reason: 'photo_not_owned' },
      });
    });

    it('refuses an own-prefix pair whose object does not exist (not yet stripped)', async () => {
      await expect(callFunction('doPostTask', payload({
        photos: [{ uid: seed.parent1.uid, photoId: 'never-uploaded' }],
      }), parent1Token)).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { reason: 'photo_not_ready' },
      });
    });

    it('refuses malformed pairs and path-smuggling ids at the validator', async () => {
      await expect(callFunction('doPostTask', payload({
        photos: [{ uid: seed.parent1.uid, photoId: '../p2-photo-1' }],
      }), parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doPostTask', payload({
        photos: [{ photoId: 'p1-photo-1' }],
      }), parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doPostTask', payload({
        photos: Array.from({ length: 7 }, (_, i) => ({ uid: seed.parent1.uid, photoId: `x${i}` })),
      }), parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });

  describe('doUpdateTask photo pins (added-only check, §8)', () => {
    let taskId: string;

    beforeAll(async () => {
      // Parent2 posts with THEIR photo — so the stored pair belongs to the
      // co-parent from parent1's later point of view.
      ({ taskId } = await callFunction<{ taskId: string }>('doPostTask', payload({
        photos: [{ uid: seed.parent2.uid, photoId: 'p2-photo-1' }],
      }), parent2Token));
    });

    afterAll(async () => {
      await getDb().collection('doTasks').doc(taskId).delete();
    });

    it('the co-parent ADDS their own photo; the other parent’s existing pair passes through untouched', async () => {
      await callFunction('doUpdateTask', {
        taskId,
        photos: [
          { uid: seed.parent2.uid, photoId: 'p2-photo-1' }, // existing — not re-checked
          { uid: seed.parent1.uid, photoId: 'p1-photo-1' }, // added — caller-prefix checked
        ],
      }, parent1Token);
      const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
      expect(task.photos).toEqual([
        { uid: seed.parent2.uid, photoId: 'p2-photo-1' },
        { uid: seed.parent1.uid, photoId: 'p1-photo-1' },
      ]);
    });

    it('REFUSES an ADDED pair under another uploader’s prefix (the update-path hijack pin)', async () => {
      await expect(callFunction('doUpdateTask', {
        taskId,
        photos: [{ uid: DOER_UID, photoId: 'doer-photo-1' }],
      }, parent1Token)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { reason: 'photo_not_owned' },
      });
      // And an added own-prefix pair that was never stripped:
      await expect(callFunction('doUpdateTask', {
        taskId,
        photos: [{ uid: seed.parent1.uid, photoId: 'ghost-photo' }],
      }, parent1Token)).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { reason: 'photo_not_ready' },
      });
    });

    it('photos can be removed by omission (replacement array is the edit)', async () => {
      await callFunction('doUpdateTask', {
        taskId,
        photos: [{ uid: seed.parent1.uid, photoId: 'p1-photo-1' }],
      }, parent1Token);
      const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
      expect(task.photos).toEqual([{ uid: seed.parent1.uid, photoId: 'p1-photo-1' }]);
    });
  });

  // Signing callables: offline emulator mode cannot mint signed URLs (no
  // GCP credentials — the getVerificationDocument precedent), so POSITIVE
  // standing is proven by failing AFTER the authz gate with anything but
  // PERMISSION_DENIED / UNAUTHENTICATED / NOT_FOUND, and negatives by the
  // gate's own code.
  const PASSES_AUTHZ = {
    code: expect.not.stringMatching(/PERMISSION_DENIED|UNAUTHENTICATED|NOT_FOUND|INVALID_ARGUMENT/),
  };

  describe('doGetOwnPhotoUrl', () => {
    it('rejects unauthenticated calls and malformed ids', async () => {
      await expect(callFunction('doGetOwnPhotoUrl', { photoId: 'p1-photo-1' }))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      await expect(callFunction('doGetOwnPhotoUrl', { photoId: 'a/b' }, parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('passes the gate for the caller’s own existing photo (signing itself needs GCP creds)', async () => {
      await expect(callFunction('doGetOwnPhotoUrl', { photoId: 'p1-photo-1' }, parent1Token))
        .rejects.toMatchObject(PASSES_AUTHZ);
    });

    it('is structurally scoped to the caller: another user’s photoId is simply not-found under the caller’s prefix', async () => {
      await expect(callFunction('doGetOwnPhotoUrl', { photoId: 'doer-photo-1' }, parent1Token))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('a blocked account is refused — blocked must close the signing surface too', async () => {
      const db = getDb();
      await db.collection('users').doc(seed.parent1.uid).update({ status: 'blocked' });
      try {
        await expect(callFunction('doGetOwnPhotoUrl', { photoId: 'p1-photo-1' }, parent1Token))
          .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      } finally {
        await db.collection('users').doc(seed.parent1.uid).update({ status: 'active' });
      }
    });
  });

  describe('doGetTaskPhotoUrl (the §7.2 audience, reproduced)', () => {
    let openTaskId: string;

    beforeAll(async () => {
      ({ taskId: openTaskId } = await callFunction<{ taskId: string }>('doPostTask', payload({
        photos: [{ uid: seed.parent1.uid, photoId: 'p1-photo-1' }],
      }), parent1Token));
    });

    afterAll(async () => {
      await getDb().collection('doTasks').doc(openTaskId).delete();
    });

    it('family member and enrolled doer pass the gate on an OPEN task; an outsider does not', async () => {
      await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-1' }, parent2Token))
        .rejects.toMatchObject(PASSES_AUTHZ);
      await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-1' }, doerToken))
        .rejects.toMatchObject(PASSES_AUTHZ);
      // A babysitter-only account is authenticated but OFF the board (§7.2).
      await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-1' }, outsiderToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('a photoId not on the task is refused even for the family', async () => {
      await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-2' }, parent1Token))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('on an ASSIGNED task: the assigned doer passes, an unrelated doer is refused (round-7 board scoping)', async () => {
      const db = getDb();
      await db.collection('doTasks').doc(openTaskId).update({
        status: 'assigned', assignedUserId: DOER_UID,
      });
      try {
        await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-1' }, doerToken))
          .rejects.toMatchObject(PASSES_AUTHZ);
        // Another enrolled doer must NOT see a peer's assignment photos.
        await getAdminAuth().createUser({ uid: 'doer-photos-2', email: 'doer.photos2@ejm.org' });
        await db.collection('users').doc('doer-photos-2').set({
          uid: 'doer-photos-2', status: 'active', firstName: 'Zed', lastName: 'Doer',
          profiles: { doer: { enrollmentComplete: true, notifyNewTasks: false, categories: [], bio: null, defaultRate: null, hasCar: false, hasBike: false } },
          notifPrefs: {}, fcmTokens: [], createdAt: new Date(), updatedAt: new Date(),
        });
        const otherDoerToken = await getIdToken('doer-photos-2');
        await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-1' }, otherDoerToken))
          .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      } finally {
        await db.collection('doTasks').doc(openTaskId).update({
          status: 'open', assignedUserId: null,
        });
      }
    });

    it('a blocked doer is refused even on an open task', async () => {
      const db = getDb();
      await db.collection('users').doc(DOER_UID).update({ status: 'blocked' });
      try {
        await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-1' }, doerToken))
          .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      } finally {
        await db.collection('users').doc(DOER_UID).update({ status: 'active' });
      }
    });

    it('a blocked ADMIN is refused too — every disjunct requires an active account', async () => {
      const db = getDb();
      await getAdminAuth().createUser({ uid: 'blocked-admin-photos', email: 'blocked.admin.photos@test.com' });
      await db.collection('users').doc('blocked-admin-photos').set({
        uid: 'blocked-admin-photos', isAdmin: true, status: 'blocked',
        firstName: 'Bl', lastName: 'Ocked', createdAt: new Date(), updatedAt: new Date(),
      });
      const blockedAdminToken = await getIdToken('blocked-admin-photos');
      await expect(callFunction('doGetTaskPhotoUrl', { taskId: openTaskId, photoId: 'p1-photo-1' }, blockedAdminToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});
