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

  it('withholds contacts on a PENDING sitter-initiated request (issue #207 PR3)', async () => {
    // Being on the appointment was enough while only a family could create
    // one. Published searches let any active sitter mint a pending
    // appointment unilaterally, so contacts must wait for the family's yes —
    // the same consent boundary address/latLng/pets/note sit behind
    // (PR #212 review).
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.babysitter1.uid,
      initiatedBy: 'babysitter',
      publishedSearchId: 'ps-1',
      status: 'pending',
    });

    await expect(
      callFunction('getParentContacts', { appointmentId: apptId }, babysitterToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('a DECLINED sitter-initiated request keeps contacts withheld', async () => {
    // The doc persists after a decline, so a status check that only excluded
    // 'pending' would hand them over afterwards.
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.babysitter1.uid,
      initiatedBy: 'babysitter',
      publishedSearchId: 'ps-1',
      status: 'rejected',
      statusReason: 'declined_by_family',
    });

    await expect(
      callFunction('getParentContacts', { appointmentId: apptId }, babysitterToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('releases contacts once the family CONFIRMS a sitter-initiated request', async () => {
    const apptId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.babysitter1.uid,
      initiatedBy: 'babysitter',
      publishedSearchId: 'ps-1',
      status: 'confirmed',
    });

    const result = await callFunction<{ contacts: unknown[] }>(
      'getParentContacts', { appointmentId: apptId }, babysitterToken,
    );
    expect(result.contacts).toHaveLength(2);
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
