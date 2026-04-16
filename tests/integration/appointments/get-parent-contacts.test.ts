import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('getParentContacts', () => {
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

  it('returns all parent contacts for the family', async () => {
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const result = await callFunction<{
      contacts: Array<{ firstName: string; lastName: string; email: string; phone?: string }>;
    }>('getParentContacts', { appointmentId: apptId }, babysitterToken);

    expect(result.contacts).toBeDefined();
    // Family 1 (Dupont) has 2 parents: Marie and Pierre
    expect(result.contacts).toHaveLength(2);

    const emails = result.contacts.map((c) => c.email).sort();
    expect(emails).toEqual(['marie.dupont@test.com', 'pierre.dupont@test.com']);
  });

  it('includes phone when set (Marie has phone)', async () => {
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const result = await callFunction<{
      contacts: Array<{ email: string; phone?: string }>;
    }>('getParentContacts', { appointmentId: apptId }, babysitterToken);

    const marie = result.contacts.find((c) => c.email === 'marie.dupont@test.com');
    expect(marie?.phone).toBe('+33 612345678');
  });

  it('rejects non-assigned babysitter', async () => {
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const otherToken = await getIdToken(seed.babysitter3.uid);
    await expect(
      callFunction('getParentContacts', { appointmentId: apptId }, otherToken)
    ).rejects.toThrow();
  });

  it('rejects missing appointmentId', async () => {
    await expect(
      callFunction('getParentContacts', {}, babysitterToken)
    ).rejects.toThrow();
  });
});
