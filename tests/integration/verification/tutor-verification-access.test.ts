import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedVerification, type SeedData } from '../../setup/seed.js';

/**
 * Access-side coverage for the tutor verification flow:
 *   - getVerificationStatus role param (tutor branch + parent regression)
 *   - getVerificationDocument owner-authorization branch
 *   - listPendingVerifications robustness with familyId-less tutor docs
 *
 * As with get-verification-document.test.ts we do NOT exercise the
 * Storage-emulator signed-URL path (getSignedUrl needs GCP credentials not
 * present offline). For getVerificationDocument we assert only the
 * AUTHORIZATION boundary: a non-owner is rejected with PERMISSION_DENIED while
 * an authorized caller (owner / admin) gets PAST authorization (any resulting
 * error is a Storage-layer error, never PERMISSION_DENIED).
 */

interface TutorStatusResponse {
  verification: { identityStatus: string };
  documents: Array<{ id: string; type: string; status: string; uploadedByUserId: string }>;
}

interface ParentStatusResponse {
  verification: {
    identityStatus: string;
    enrollmentStatus: string;
    isFullyVerified: boolean;
    isEjmFamily: boolean;
  };
  documents: Array<{ id: string; familyId: string; type: string; status: string }>;
}

interface ListResponse {
  verifications: Array<{
    id: string;
    type: string;
    status: string;
    familyId?: string;
    familyName: string;
    parentName: string;
    tutorName?: string;
  }>;
}

/** Call and return the HttpsError code, or 'OK' if it resolved. */
async function callCode(name: string, data: unknown, token: string): Promise<string> {
  try {
    await callFunction(name, data, token);
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code || 'UNKNOWN';
  }
}

describe('tutor verification access', () => {
  let seed: SeedData;
  let tutorToken: string;
  let parent1Token: string;
  let adminToken: string;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    tutorToken = await getIdToken(seed.tutor1.uid);
    parent1Token = await getIdToken(seed.parent1.uid);
    adminToken = await getIdToken(seed.admin.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const verifications = await db.collection('verifications').get();
    await Promise.all(verifications.docs.map((d) => d.ref.delete()));
    await db.collection('users').doc(seed.tutor1.uid).update({
      'profiles.tutor.verification': { identityStatus: 'not_submitted' },
      'profiles.tutor.enrollmentComplete': false,
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

  describe('getVerificationStatus role param', () => {
    it('role=tutor returns the tutor verification state + own documents', async () => {
      const verificationId = await submitTutorDoc();

      const result = await callFunction<TutorStatusResponse>(
        'getVerificationStatus',
        { role: 'tutor' },
        tutorToken,
      );

      expect(result.verification.identityStatus).toBe('pending');
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].id).toBe(verificationId);
      expect(result.documents[0].type).toBe('tutor_identity');
      expect(result.documents[0].status).toBe('pending');
      expect(result.documents[0].uploadedByUserId).toBe(seed.tutor1.uid);
    });

    it('role=tutor with no submissions returns not_submitted and no docs', async () => {
      const result = await callFunction<TutorStatusResponse>(
        'getVerificationStatus',
        { role: 'tutor' },
        tutorToken,
      );

      expect(result.verification.identityStatus).toBe('not_submitted');
      expect(result.documents).toEqual([]);
    });

    it('rejects role=tutor from a caller without a tutor profile', async () => {
      await expect(
        callFunction('getVerificationStatus', { role: 'tutor' }, parent1Token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('regression: default (parent) call is unchanged', async () => {
      const result = await callFunction<ParentStatusResponse>(
        'getVerificationStatus',
        {},
        parent1Token,
      );

      expect(result.verification.isFullyVerified).toBe(true);
      expect(result.verification.identityStatus).toBe('approved');
      expect(result.verification.enrollmentStatus).toBe('approved');
    });
  });

  describe('getVerificationDocument owner authorization', () => {
    const tutorPath = () => `verification-documents/${seed.tutor1.uid}/id.pdf`;

    it('owner tutor gets past authorization (not PERMISSION_DENIED)', async () => {
      const code = await callCode('getVerificationDocument', { filePath: tutorPath() }, tutorToken);
      expect(code).not.toBe('PERMISSION_DENIED');
    });

    it('admin gets past authorization (not PERMISSION_DENIED)', async () => {
      const code = await callCode('getVerificationDocument', { filePath: tutorPath() }, adminToken);
      expect(code).not.toBe('PERMISSION_DENIED');
    });

    it('a non-owner, non-admin caller is denied', async () => {
      await expect(
        callFunction('getVerificationDocument', { filePath: tutorPath() }, babysitterToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  describe('listPendingVerifications with tutor docs', () => {
    it('returns a pending tutor doc without crashing and with a usable name', async () => {
      await submitTutorDoc();
      // A family doc alongside it to prove mixed lists still enrich correctly.
      await seedVerification({
        familyId: seed.family1Id,
        uploadedByUserId: seed.parent1.uid,
        type: 'identity',
        status: 'pending',
      });

      const result = await callFunction<ListResponse>(
        'listPendingVerifications',
        {},
        adminToken,
      );

      expect(result.verifications).toHaveLength(2);

      const tutorDoc = result.verifications.find((v) => v.type === 'tutor_identity');
      expect(tutorDoc).toBeDefined();
      expect(tutorDoc!.status).toBe('pending');
      expect(tutorDoc!.familyId).toBeUndefined();
      expect(tutorDoc!.tutorName).toBe('Noa Katz');

      const familyDoc = result.verifications.find((v) => v.type === 'identity');
      expect(familyDoc?.familyName).toBe('Dupont');
      expect(familyDoc?.parentName).toBe('Marie Dupont');
    });
  });
});
