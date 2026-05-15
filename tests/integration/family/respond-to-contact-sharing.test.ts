import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedContactSharingRequest, type SeedData } from '../../setup/seed.js';

describe('respondToContactSharing', () => {
  let seed: SeedData;
  let bs1Token: string;
  let bs2Token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    bs1Token = await getIdToken(seed.babysitter1.uid);
    bs2Token = await getIdToken(seed.babysitter2.uid);
  });

  afterAll(async () => { await clearAll(); });

  beforeEach(async () => {
    const db = getDb();
    const reqs = await db.collection('contactSharingRequests').get();
    await Promise.all(reqs.docs.map((d) => d.ref.delete()));
    await db.collection('users').doc(seed.babysitter1.uid).update({ approvedFamilies: [] });
  });

  it('approve sets status=approved and adds familyId to approvedFamilies', async () => {
    const requestId = await seedContactSharingRequest({ babysitterUserId: seed.babysitter1.uid, familyId: seed.family1Id });
    await callFunction('respondToContactSharing', { requestId, action: 'approve' }, bs1Token);
    const db = getDb();
    const reqDoc = await db.collection('contactSharingRequests').doc(requestId).get();
    expect(reqDoc.data()!.status).toBe('approved');
    const userDoc = await db.collection('users').doc(seed.babysitter1.uid).get();
    expect(userDoc.data()!.approvedFamilies).toContain(seed.family1Id);
  });

  it('decline sets status=declined', async () => {
    const requestId = await seedContactSharingRequest({ babysitterUserId: seed.babysitter1.uid, familyId: seed.family1Id });
    await callFunction('respondToContactSharing', { requestId, action: 'decline' }, bs1Token);
    const db = getDb();
    const reqDoc = await db.collection('contactSharingRequests').doc(requestId).get();
    expect(reqDoc.data()!.status).toBe('declined');
  });

  it('rejects responses from a non-target babysitter', async () => {
    const requestId = await seedContactSharingRequest({ babysitterUserId: seed.babysitter1.uid, familyId: seed.family1Id });
    await expect(callFunction('respondToContactSharing', { requestId, action: 'approve' }, bs2Token)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects unknown requestId', async () => {
    await expect(callFunction('respondToContactSharing', { requestId: 'does-not-exist', action: 'approve' }, bs1Token)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
