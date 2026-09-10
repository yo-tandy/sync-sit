import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth, waitForEffectiveSearchable } from '../../setup/emulator.js';

// Issue #435 milestone, PR4: enrollBabysitter/enrollTutor's crossApp mode
// extended to accept a ROOT-ONLY identity (enrollStudentIdentity's shape —
// no OTHER provider profile at all) instead of requiring one to derive from.
// Before this PR, every crossApp call below would have rejected
// FAILED_PRECONDITION ("No verified EJM identity on this account") because
// neither profiles.tutor nor profiles.babysitter existed on the caller's doc.

const CODE = '123456';

async function seedCode(email: string) {
  await getDb().collection('verificationCodes').doc(email.toLowerCase()).set({
    code: CODE,
    identityClass: 'ejm',
    email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    createdAt: new Date(),
  });
}

/** Creates a root-only identity via the REAL enrollStudentIdentity callable
 *  (not hand-seeded) — the exact shape the unified flow's account-creation
 *  step produces, and what the "choose your app" screen's crossApp calls
 *  are handed. */
async function createRootOnlyStudent(
  email: string,
  overrides: Record<string, unknown> = {},
): Promise<{ uid: string; token: string }> {
  await seedCode(email);
  const result = await callFunction<{ uid: string }>('enrollStudentIdentity', {
    ejemEmail: email,
    verificationCode: CODE,
    password: 'Str0ngPass1',
    consentVersion: '1.0',
    firstName: 'Robin',
    lastName: 'Root',
    dateOfBirth: '2008-05-01',
    classLevel: '1ère',
    gender: 'other',
    contactEmail: `${email.split('@')[0]}.contact@test.com`,
    contactPhone: '+33600000099',
    whatsapp: '+33600000099',
    contactVisibilityConsent: false,
    ...overrides,
  });
  const token = await getIdToken(result.uid);
  return { uid: result.uid, token };
}

describe('unified flow: crossApp on a root-only identity (issue #435 PR4)', () => {
  afterAll(async () => {
    await clearAll();
  });

  describe('enrollBabysitter({crossApp: true}) — sit continuation', () => {
    it('succeeds with no OTHER profile to derive from; copies classLevel/gender/contact from root', async () => {
      const { uid, token } = await createRootOnlyStudent('robin.sit@ejm-test.org');

      const result = await callFunction<{ success: boolean; uid: string }>(
        'enrollBabysitter',
        { crossApp: true, consentVersion: '1.0' },
        token,
      );
      expect(result.uid).toBe(uid);

      const after = await waitForEffectiveSearchable(uid, 'babysitter');
      expect(after.profiles.babysitter.enrollmentComplete).toBe(false);
      expect(after.profiles.babysitter.ejemEmail).toBe('robin.sit@ejm-test.org');
      expect(after.profiles.babysitter.contactEmail).toBe('robin.sit.contact@test.com');
      expect(after.profiles.babysitter.contactPhone).toBe('+33600000099');
      expect(after.profiles.babysitter.whatsapp).toBe('+33600000099');
      // classLevel/gender stay root-only — no copy onto the profile.
      expect(after.profiles.babysitter.classLevel).toBeUndefined();
      expect(after.classLevel).toBe('1ère');
      expect(after.gender).toBe('other');
      // Root is untouched by fillBaseFields (already populated).
      expect(after.firstName).toBe('Robin');
    });

    it('seeds profiles.babysitter.searchable from the root contactVisibilityConsent (true)', async () => {
      const { token, uid } = await createRootOnlyStudent('robin.consent.sit@ejm-test.org', {
        contactVisibilityConsent: true,
      });
      await callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token);
      const after = (await getDb().collection('users').doc(uid).get()).data()!;
      expect(after.profiles.babysitter.searchable).toBe(true);
    });

    it('leaves profiles.babysitter.searchable false when consent was not given', async () => {
      const { token, uid } = await createRootOnlyStudent('robin.noconsent.sit@ejm-test.org', {
        contactVisibilityConsent: false,
      });
      await callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token);
      const after = (await getDb().collection('users').doc(uid).get()).data()!;
      expect(after.profiles.babysitter.searchable).toBe(false);
    });
  });

  describe('enrollTutor({crossApp: true, subjects}) — study continuation', () => {
    // levels values come from study's OWN (unrelated, non-accented)
    // CLASS_LEVELS enum — "which school levels this subject is taught at" —
    // not the shared LYCEE_CLASS_LEVELS the student's own classLevel uses.
    const SUBJECTS = [{ subject: 'math', levels: ['CP'], rate: 25 }];

    it('succeeds with no OTHER profile to derive from; resolves classLevel/gender/contact from root', async () => {
      const { uid, token } = await createRootOnlyStudent('robin.study@ejm-test.org');

      const result = await callFunction<{ uid: string }>(
        'enrollTutor',
        { crossApp: true, subjects: SUBJECTS, consentVersion: '2025-12-01' },
        token,
      );
      expect(result.uid).toBe(uid);

      const after = await waitForEffectiveSearchable(uid, 'tutor');
      // Tutors are complete-at-creation (owner decision) unlike sit's babysitter shape.
      expect(after.profiles.tutor.enrollmentComplete).toBe(true);
      expect(after.profiles.tutor.subjects).toEqual(SUBJECTS);
      expect(after.profiles.tutor.contactEmail).toBe('robin.study.contact@test.com');
      expect(after.profiles.tutor.contactPhone).toBe('+33600000099');
      // classLevel/gender written to root only, per the new-account convention.
      expect(after.classLevel).toBe('1ère');
      expect(after.gender).toBe('other');
      expect(after.firstName).toBe('Robin');
    });

    it('seeds profiles.tutor.searchable from the root contactVisibilityConsent (true)', async () => {
      const { token, uid } = await createRootOnlyStudent('robin.consent.study@ejm-test.org', {
        contactVisibilityConsent: true,
      });
      await callFunction('enrollTutor', { crossApp: true, subjects: SUBJECTS, consentVersion: '2025-12-01' }, token);
      const after = (await getDb().collection('users').doc(uid).get()).data()!;
      expect(after.profiles.tutor.searchable).toBe(true);
    });

    it('leaves profiles.tutor.searchable false when consent was not given', async () => {
      const { token, uid } = await createRootOnlyStudent('robin.noconsent.study@ejm-test.org', {
        contactVisibilityConsent: false,
      });
      await callFunction('enrollTutor', { crossApp: true, subjects: SUBJECTS, consentVersion: '2025-12-01' }, token);
      const after = (await getDb().collection('users').doc(uid).get()).data()!;
      expect(after.profiles.tutor.searchable).toBe(false);
    });
  });

  it('a doc with profiles: {} and NO root ejemEmail is still rejected (mutation pin: identity proof still required)', async () => {
    const uid = 'unified-crossapp-no-identity';
    await getAdminAuth().createUser({ uid, email: 'noidentity@test.com' });
    await getDb().collection('users').doc(uid).set({
      uid, email: 'noidentity@test.com', status: 'active', profiles: {},
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    await expect(
      callFunction('enrollTutor', { crossApp: true, subjects: [{ subject: 'math', levels: ['CP'], rate: 25 }], consentVersion: '2025-12-01' }, token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });
});
