/**
 * Integration tests for publishManualReference callable (BL-6 part 2).
 *
 * The callable is the only legitimate way for an admin to promote a manual
 * reference from status='private' -> 'published'. The Firestore rule layer
 * restricts client transitions; this callable performs the write server-side
 * after verifying the caller is an admin.
 *
 * NOTE: Uses callFunction (not callCallable) which is the existing test
 * infrastructure. Error codes are uppercase (UNAUTHENTICATED, PERMISSION_DENIED,
 * etc.) because callFunction sets err.code = body.error.status from the raw
 * HTTP emulator response.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb, getIdToken, callFunction } from '../../setup/emulator.js';
import { seedTestData, seedReference, type SeedData } from '../../setup/seed.js';

describe('publishManualReference callable', () => {
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

  it('admin can publish a private manual reference; verifies status, approvedAt, and audit log', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
    });

    const token = await getIdToken(seed.admin.uid);
    const result = await callFunction<{ ok: boolean }>(
      'publishManualReference',
      { referenceId: refId },
      token,
    );

    expect(result.ok).toBe(true);

    const ref = await getDb().collection('references').doc(refId).get();
    const data = ref.data()!;
    expect(data.status).toBe('published');
    expect(data.approvedAt).toBeTruthy();
    expect(data.updatedAt).toBeTruthy();

    const logs = await getDb().collection('auditLogs')
      .where('action', '==', 'reference.publish')
      .limit(1)
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().details?.referenceId).toBe(refId);
  });

  it('rejects non-admin caller (even the babysitter who owns the reference)', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
    });

    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callFunction(
      'publishManualReference',
      { referenceId: refId },
      token,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects when reference is type=family_submitted', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      status: 'private',
      submittedByUserId: seed.parent1.uid,
    });

    const token = await getIdToken(seed.admin.uid);
    await expect(callFunction(
      'publishManualReference',
      { referenceId: refId },
      token,
    )).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects when manual reference is not in status=private (already published)', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'published',
    });

    const token = await getIdToken(seed.admin.uid);
    await expect(callFunction(
      'publishManualReference',
      { referenceId: refId },
      token,
    )).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects unauthenticated callers', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
    });

    await expect(callFunction(
      'publishManualReference',
      { referenceId: refId },
      // no token — unauthenticated
    )).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
