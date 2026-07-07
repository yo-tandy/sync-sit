import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedVerification, type SeedData } from '../../setup/seed.js';

describe('reviewVerification (tutor_identity)', () => {
  let seed: SeedData;
  let adminToken: string;
  let tutorToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    tutorToken = await getIdToken(seed.tutor1.uid);
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

  /** Submit a pending tutor_identity doc via the real callable; returns its id. */
  async function submitTutorDoc(fileName = 'doc.pdf'): Promise<string> {
    const { verificationId } = await callFunction<{ verificationId: string }>(
      'submitVerification',
      {
        type: 'tutor_identity',
        fileUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/verification-documents%2F${seed.tutor1.uid}%2F${fileName}`,
        fileName,
      },
      tutorToken,
    );
    return verificationId;
  }

  it('admin approves a pending tutor doc → identityStatus=approved and enrollmentComplete=true', async () => {
    const verificationId = await submitTutorDoc();

    const result = await callFunction<{ success: boolean }>(
      'reviewVerification',
      { verificationId, decision: 'approved' },
      adminToken,
    );

    expect(result.success).toBe(true);

    const db = getDb();
    const verDoc = await db.collection('verifications').doc(verificationId).get();
    expect(verDoc.data()!.status).toBe('approved');
    expect(verDoc.data()!.reviewedByAdminId).toBe(seed.admin.uid);
    expect(verDoc.data()!.reviewedAt).toBeDefined();

    const userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('approved');
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(true);
  });

  it('admin rejects a tutor doc with reason → identityStatus=rejected, enrollmentComplete stays false', async () => {
    const verificationId = await submitTutorDoc();

    const result = await callFunction<{ success: boolean }>(
      'reviewVerification',
      { verificationId, decision: 'rejected', rejectionReason: 'Document unreadable' },
      adminToken,
    );

    expect(result.success).toBe(true);

    const db = getDb();
    const verDoc = await db.collection('verifications').doc(verificationId).get();
    expect(verDoc.data()!.status).toBe('rejected');
    expect(verDoc.data()!.rejectionReason).toBe('Document unreadable');

    const userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('rejected');
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(false);
  });

  it('resubmit-after-reject then approve drives the full loop to enrollmentComplete=true', async () => {
    // First submission is rejected
    const first = await submitTutorDoc('v1.pdf');
    await callFunction(
      'reviewVerification',
      { verificationId: first, decision: 'rejected', rejectionReason: 'Blurry' },
      adminToken,
    );

    const db = getDb();
    let userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('rejected');
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(false);

    // Tutor resubmits → back to pending (replaces prior doc)
    const second = await submitTutorDoc('v2.pdf');
    expect(second).not.toBe(first);
    userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('pending');

    // Admin approves the resubmission
    await callFunction(
      'reviewVerification',
      { verificationId: second, decision: 'approved' },
      adminToken,
    );

    const verDoc = await db.collection('verifications').doc(second).get();
    expect(verDoc.data()!.status).toBe('approved');

    userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('approved');
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(true);
  });

  it('rejection revokes a prior approval: approve→resubmit(pending, still complete)→reject clears enrollmentComplete', async () => {
    const db = getDb();

    // Approve first submission → enrolled
    const first = await submitTutorDoc('a.pdf');
    await callFunction(
      'reviewVerification',
      { verificationId: first, decision: 'approved' },
      adminToken,
    );
    let userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('approved');
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(true);

    // Resubmit → identityStatus back to pending, but a previously-approved enrollment survives a pending re-check.
    // submitVerification must NOT touch enrollmentComplete.
    const second = await submitTutorDoc('b.pdf');
    expect(second).not.toBe(first);
    userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('pending');
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(true);

    // Reject the resubmission → revokes approval.
    await callFunction(
      'reviewVerification',
      { verificationId: second, decision: 'rejected', rejectionReason: 'No longer valid' },
      adminToken,
    );
    userDoc = await db.collection('users').doc(seed.tutor1.uid).get();
    expect(userDoc.data()!.profiles.tutor.verification.identityStatus).toBe('rejected');
    expect(userDoc.data()!.profiles.tutor.enrollmentComplete).toBe(false);
  });

  it('regression: family identity review by admin still recomputes family verification', async () => {
    const verificationId = await seedVerification({
      familyId: seed.family2Id,
      uploadedByUserId: seed.parent3.uid,
      type: 'identity',
    });

    const result = await callFunction<{ success: boolean; isFullyVerified: boolean }>(
      'reviewVerification',
      { verificationId, decision: 'approved' },
      adminToken,
    );

    expect(result.success).toBe(true);
    expect(result.isFullyVerified).toBe(false); // enrollment still pending

    const db = getDb();
    const verDoc = await db.collection('verifications').doc(verificationId).get();
    expect(verDoc.data()!.status).toBe('approved');
    expect(verDoc.data()!.reviewedByAdminId).toBe(seed.admin.uid);

    const familyDoc = await db.collection('families').doc(seed.family2Id).get();
    expect(familyDoc.data()!.verification.identityStatus).toBe('approved');
    expect(familyDoc.data()!.verification.isFullyVerified).toBe(false);
  });
});
