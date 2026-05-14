import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('addPreferredBabysitter', () => {
  let seed: SeedData;
  let parent1Token: string;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => { await clearAll(); });

  beforeEach(async () => {
    const db = getDb();
    await db.collection('families').doc(seed.family1Id).update({ preferredBabysitters: [] });
    await db.collection('families').doc(seed.family2Id).update({ preferredBabysitters: [] });
    const reqs = await db.collection('contactSharingRequests').get();
    await Promise.all(reqs.docs.map((d) => d.ref.delete()));
    const notifs = await db.collection('notifications').get();
    await Promise.all(notifs.docs.map((d) => d.ref.delete()));
  });

  it('adds to preferredBabysitters and creates pending sharing request', async () => {
    const result = await callFunction<{ success: boolean }>('addPreferredBabysitter', { babysitterUserId: seed.babysitter1.uid }, parent1Token);
    expect(result.success).toBe(true);
    const db = getDb();
    const fam = await db.collection('families').doc(seed.family1Id).get();
    expect(fam.data()!.preferredBabysitters).toContain(seed.babysitter1.uid);
    const reqs = await db.collection('contactSharingRequests').where('babysitterUserId', '==', seed.babysitter1.uid).where('familyId', '==', seed.family1Id).get();
    expect(reqs.docs.length).toBe(1);
    expect(reqs.docs[0].data().status).toBe('pending');
  });

  it('is idempotent on re-add', async () => {
    await callFunction('addPreferredBabysitter', { babysitterUserId: seed.babysitter1.uid }, parent1Token);
    await callFunction('addPreferredBabysitter', { babysitterUserId: seed.babysitter1.uid }, parent1Token);
    const db = getDb();
    const fam = await db.collection('families').doc(seed.family1Id).get();
    const arr = fam.data()!.preferredBabysitters as string[];
    expect(arr.filter((id) => id === seed.babysitter1.uid).length).toBe(1);
    const reqs = await db.collection('contactSharingRequests').where('babysitterUserId', '==', seed.babysitter1.uid).where('familyId', '==', seed.family1Id).get();
    expect(reqs.docs.length).toBe(1);
  });

  it('rejects unauthenticated', async () => {
    await expect(callFunction('addPreferredBabysitter', { babysitterUserId: seed.babysitter1.uid })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects babysitters', async () => {
    await expect(callFunction('addPreferredBabysitter', { babysitterUserId: seed.babysitter2.uid }, babysitterToken)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects missing babysitterUserId', async () => {
    await expect(callFunction('addPreferredBabysitter', {}, parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
