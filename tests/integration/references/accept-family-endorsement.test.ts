/**
 * Integration tests for acceptFamilyEndorsement callable (BL-6 part 1).
 *
 * The callable is the only legitimate way for a babysitter to transition a
 * family_submitted reference from private -> approved. The Firestore rule
 * layer restricts client transitions to private/removed; this callable
 * performs the write server-side after validating the caller is the
 * babysitter of record.
 *
 * NOTE: Uses callFunction (not callCallable) which is the existing test
 * infrastructure. Error codes are uppercase (UNAUTHENTICATED, PERMISSION_DENIED,
 * etc.) because callFunction sets err.code = body.error.status from the raw
 * HTTP emulator response.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb, getIdToken, callFunction } from '../../setup/emulator.js';
import { seedTestData, seedReference, type SeedData } from '../../setup/seed.js';

describe('acceptFamilyEndorsement callable', () => {
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
    const logs = await db.collection('auditLogs').get();
    await Promise.all(logs.docs.map((d) => d.ref.delete()));
  });

  it('transitions a private family_submitted ref to approved when caller is the babysitter; verifies audit log entry was written', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      status: 'private',
      submittedByUserId: seed.parent1.uid,
    });

    const token = await getIdToken(seed.babysitter1.uid);
    const result = await callFunction<{ ok: boolean }>(
      'acceptFamilyEndorsement',
      { referenceId: refId },
      token,
    );

    expect(result.ok).toBe(true);

    const ref = await getDb().collection('references').doc(refId).get();
    const data = ref.data()!;
    expect(data.status).toBe('approved');
    expect(data.approvedAt).toBeTruthy();
    expect(data.updatedAt).toBeTruthy();

    const logs = await getDb().collection('auditLogs')
      .where('action', '==', 'reference.accept')
      .limit(1)
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().details?.referenceId).toBe(refId);
  });

  it('rejects when caller is not the babysitter of the reference', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      status: 'private',
      submittedByUserId: seed.parent1.uid,
    });

    // babysitter2 is not the babysitter on this reference
    const token = await getIdToken(seed.babysitter2.uid);
    await expect(callFunction(
      'acceptFamilyEndorsement',
      { referenceId: refId },
      token,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects when reference is not type=family_submitted', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
    });

    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callFunction(
      'acceptFamilyEndorsement',
      { referenceId: refId },
      token,
    )).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects when reference is not in status=private', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      status: 'approved',
      submittedByUserId: seed.parent1.uid,
    });

    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callFunction(
      'acceptFamilyEndorsement',
      { referenceId: refId },
      token,
    )).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects unauthenticated callers', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      status: 'private',
      submittedByUserId: seed.parent1.uid,
    });

    await expect(callFunction(
      'acceptFamilyEndorsement',
      { referenceId: refId },
      // no token — unauthenticated
    )).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
