/**
 * Integration tests for submitFamilyEndorsement callable (BL-5).
 *
 * The callable is the only legitimate way for a parent to create a
 * family_submitted reference. The rule layer no longer accepts the
 * family_submitted branch — see firestore.rules and rules tests.
 *
 * NOTE: Uses callFunction (not callCallable) which is the existing test
 * infrastructure. Error codes are uppercase (UNAUTHENTICATED, PERMISSION_DENIED,
 * etc.) because callFunction sets err.code = body.error.status from the raw
 * HTTP emulator response.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb, getIdToken, callFunction } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('submitFamilyEndorsement callable', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const snap = await db.collection('references').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    const apts = await db.collection('appointments').get();
    await Promise.all(apts.docs.map((d) => d.ref.delete()));
  });

  it('creates a private family_submitted reference when caller has a confirmed appointment', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    const result = await callFunction<{ referenceId: string }>(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'Lea was wonderful with our kids.',
        refName: 'Marie Dupont',
      },
      token,
    );

    expect(result.referenceId).toBeTruthy();
    const ref = await getDb().collection('references').doc(result.referenceId).get();
    const data = ref.data()!;
    expect(data.type).toBe('family_submitted');
    expect(data.status).toBe('private');
    expect(data.submittedByUserId).toBe(seed.parent1.uid);
    expect(data.submittedByFamilyId).toBe(seed.parent1.familyId);
    expect(data.babysitterUserId).toBe(seed.babysitter1.uid);
    expect(data.appointmentId).toBe(aptId);
    expect(data.referenceText).toBe('Lea was wonderful with our kids.');
    // Server-derived, not client-supplied:
    expect(typeof data.isEjmFamily).toBe('boolean');
    expect(data.createdAt).toBeTruthy();
  });

  it('rejects when caller has no confirmed appointment with the babysitter', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'pending', // not confirmed
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'Trying to endorse without a real appointment.',
        refName: 'Marie Dupont',
      },
      token,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const snap = await getDb().collection('references').get();
    expect(snap.size).toBe(0);
  });

  it('rejects when appointmentId belongs to a different family', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent3.familyId, // different family (family2)
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent3.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'Trying to ride on another family appointment.',
        refName: 'Marie Dupont',
      },
      token,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects when babysitterUserId in the request does not match the appointment', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter2.uid, // different babysitter
        appointmentId: aptId,
        referenceText: 'Trying to endorse a different babysitter.',
        refName: 'Marie Dupont',
      },
      token,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects self-endorsement (caller is the babysitter)', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    // Use babysitter1's token instead of a parent's
    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'Self-promotion attempt.',
        refName: 'Lea Bernard',
      },
      token,
    )).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects when referenceText is too short', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'too short',
        refName: 'Marie Dupont',
      },
      token,
    )).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects duplicate endorsement for same (submitter, babysitter, appointment) triple', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'First endorsement, all valid.',
        refName: 'Marie Dupont',
      },
      token,
    );

    await expect(callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'Second endorsement, should fail.',
        refName: 'Marie Dupont',
      },
      token,
    )).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('rejects unauthenticated callers', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    await expect(callFunction(
      'submitFamilyEndorsement',
      {
        babysitterUserId: seed.babysitter1.uid,
        appointmentId: aptId,
        referenceText: 'Anonymous attempt at endorsement.',
        refName: 'Anon',
      },
      // no token — unauthenticated
    )).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
