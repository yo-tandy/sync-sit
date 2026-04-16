import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('acknowledgeModification', () => {
  let seed: SeedData;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const appts = await db.collection('appointments').get();
    await Promise.all(appts.docs.map((d) => d.ref.delete()));
  });

  it('clears modified flag when babysitter acknowledges', async () => {
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
      modified: true,
      modifiedFields: ['startTime', 'message'],
    });

    const result = await callFunction<{ success: boolean }>(
      'acknowledgeModification',
      { appointmentId: apptId },
      babysitterToken
    );

    expect(result.success).toBe(true);

    const doc = await getDb().collection('appointments').doc(apptId).get();
    expect(doc.data()!.modified).toBe(false);
    expect(doc.data()!.modifiedFields).toEqual([]);
  });

  it('rejects wrong babysitter', async () => {
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      modified: true,
      modifiedFields: ['startTime'],
    });

    const otherToken = await getIdToken(seed.babysitter3.uid);
    await expect(
      callFunction(
        'acknowledgeModification',
        { appointmentId: apptId },
        otherToken
      )
    ).rejects.toThrow();
  });

  it('rejects missing appointmentId', async () => {
    await expect(
      callFunction('acknowledgeModification', {}, babysitterToken)
    ).rejects.toThrow();
  });
});
