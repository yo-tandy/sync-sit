import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('submitVerification (tutor_identity)', () => {
  let seed: SeedData;
  let tutorToken: string;
  let parent3Token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    tutorToken = await getIdToken(seed.tutor1.uid);
    parent3Token = await getIdToken(seed.parent3.uid); // unverified family (family-martin)
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const verifications = await db.collection('verifications').get();
    await Promise.all(verifications.docs.map((d) => d.ref.delete()));
    // Reset tutor verification state to not_submitted
    await db.collection('users').doc(seed.tutor1.uid).update({
      'profiles.tutor.verification': { identityStatus: 'not_submitted' },
      'profiles.tutor.enrollmentComplete': false,
    });
    // Reset family-martin verification to not_submitted
    await db.collection('families').doc(seed.family2Id).update({
      verification: {
        identityStatus: 'not_submitted',
        enrollmentStatus: 'not_submitted',
        isFullyVerified: false,
        isEjmFamily: false,
      },
    });
  });

  it('creates a tutor_identity doc keyed by uploader and marks tutor identityStatus=pending', async () => {
    const result = await callFunction<{ verificationId: string }>(
      'submitVerification',
      {
        type: 'tutor_identity',
        fileUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/verification-documents%2F${seed.tutor1.uid}%2Fdoc.pdf`,
        fileName: 'doc.pdf',
      },
      tutorToken,
    );

    expect(result.verificationId).toBeTruthy();

    const db = getDb();
    const doc = await db.collection('verifications').doc(result.verificationId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data()!.uploadedByUserId).toBe(seed.tutor1.uid);
    expect(doc.data()!.type).toBe('tutor_identity');
    expect(doc.data()!.status).toBe('pending');
    expect(doc.data()!.fileName).toBe('doc.pdf');
    // Tutor docs carry NO familyId
    expect('familyId' in doc.data()!).toBe(false);

    const userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('pending');
    // Enrollment is not completed by submission
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(false);
  });

  it('resubmitting replaces the previous tutor_identity doc (exactly one remains)', async () => {
    const first = await callFunction<{ verificationId: string }>(
      'submitVerification',
      {
        type: 'tutor_identity',
        fileUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/verification-documents%2F${seed.tutor1.uid}%2Fv1.pdf`,
        fileName: 'v1.pdf',
      },
      tutorToken,
    );

    const second = await callFunction<{ verificationId: string }>(
      'submitVerification',
      {
        type: 'tutor_identity',
        fileUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/verification-documents%2F${seed.tutor1.uid}%2Fv2.pdf`,
        fileName: 'v2.pdf',
      },
      tutorToken,
    );

    expect(second.verificationId).not.toBe(first.verificationId);

    const db = getDb();
    const oldDoc = await db.collection('verifications').doc(first.verificationId).get();
    expect(oldDoc.exists).toBe(false);

    const remaining = await db
      .collection('verifications')
      .where('uploadedByUserId', '==', seed.tutor1.uid)
      .where('type', '==', 'tutor_identity')
      .get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe(second.verificationId);
  });

  it('rejects a parent without a tutor profile submitting tutor_identity', async () => {
    await expect(
      callFunction(
        'submitVerification',
        {
          type: 'tutor_identity',
          fileUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/verification-documents%2Fx%2Fdoc.pdf',
          fileName: 'doc.pdf',
        },
        parent3Token,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('regression: family identity submit by a parent still works unchanged', async () => {
    const result = await callFunction<{ verificationId: string }>(
      'submitVerification',
      {
        type: 'identity',
        fileUrl: 'verification-documents/family-martin/id.pdf',
        fileName: 'id.pdf',
      },
      parent3Token,
    );

    expect(result.verificationId).toBeTruthy();

    const db = getDb();
    const doc = await db.collection('verifications').doc(result.verificationId).get();
    expect(doc.data()!.familyId).toBe(seed.family2Id);
    expect(doc.data()!.uploadedByUserId).toBe(seed.parent3.uid);
    expect(doc.data()!.type).toBe('identity');
    expect(doc.data()!.status).toBe('pending');

    const familyDoc = await db.collection('families').doc(seed.family2Id).get();
    expect(familyDoc.data()!.verification.identityStatus).toBe('pending');
    expect(familyDoc.data()!.verification.isFullyVerified).toBe(false);
  });
});
