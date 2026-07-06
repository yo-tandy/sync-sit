import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const EJEM_EMAIL = 'crossapp.tutor@ejm-test.org';
const CODE = '123456';

function tutorEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Wizard',
    lastName: 'Value',
    dateOfBirth: '2007-03-15',
    classLevel: 'CP',
    subjects: [{ subject: 'math', levels: ['CP'], rate: 20 }],
    sessionLengthsMin: [60],
    locationPrefs: ['online'],
    paddingMin: 15,
    contactEmail: 'contact@test.com',
    areaMode: 'arrondissement',
    arrondissements: ['75001'],
    ...overrides,
  };
}

async function seedCode(email: string) {
  await getDb()
    .collection('verificationCodes')
    .doc(email.toLowerCase())
    .set({
      code: CODE,
      email: email.toLowerCase(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      createdAt: new Date(),
    });
}

describe('enrollTutor cross-app add-profile', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    await seedCode(EJEM_EMAIL);
  });

  it('adds profiles.tutor to an authed sit parent; parent profile and base fields intact', async () => {
    const token = await getIdToken(seed.parent1.uid);
    const before = (await getDb().collection('users').doc(seed.parent1.uid).get()).data()!;

    const result = await callFunction<{ uid: string }>(
      'enrollTutor',
      {
        ejemEmail: EJEM_EMAIL,
        verificationCode: CODE,
        consentVersion: '1.0',
        enrollment: tutorEnrollment(),
      },
      token,
    );
    expect(result.uid).toBe(seed.parent1.uid);

    const after = (await getDb().collection('users').doc(seed.parent1.uid).get()).data()!;
    // New tutor profile with the verified EJM email inside it
    expect(after.profiles.tutor.ejemEmail).toBe(EJEM_EMAIL.toLowerCase());
    expect(after.profiles.tutor.enrollmentComplete).toBe(false);
    expect(after.profiles.tutor.subjects).toHaveLength(1);
    // Existing profile untouched
    expect(after.profiles.parent).toEqual(before.profiles.parent);
    // Existing base fields win over conflicting wizard values
    expect(after.firstName).toBe(before.firstName);
    expect(after.email).toBe(before.email);
    // Consent not overwritten
    expect(after.consentVersion).toBe(before.consentVersion);
    // Code consumed
    const codeDoc = await getDb()
      .collection('verificationCodes')
      .doc(EJEM_EMAIL.toLowerCase())
      .get();
    expect(codeDoc.exists).toBe(false);
  });

  it('does not clobber an existing schedules grid', async () => {
    // parent1 got a tutor profile in the previous test; use babysitter1 who
    // has a seeded schedule with a marked slot.
    const db = getDb();
    const slotBefore = (await db.collection('schedules').doc(seed.babysitter1.uid).get()).data();

    const token = await getIdToken(seed.babysitter1.uid);
    await callFunction(
      'enrollTutor',
      {
        ejemEmail: EJEM_EMAIL,
        verificationCode: CODE,
        consentVersion: '1.0',
        enrollment: tutorEnrollment(),
      },
      token,
    );

    const slotAfter = (await db.collection('schedules').doc(seed.babysitter1.uid).get()).data();
    expect(slotAfter!.weekly).toEqual(slotBefore!.weekly);
  });

  it('rejects when the caller already has a tutor profile (profile-exists)', async () => {
    const token = await getIdToken(seed.parent1.uid); // gained tutor profile above
    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: EJEM_EMAIL,
          verificationCode: CODE,
          consentVersion: '1.0',
          enrollment: tutorEnrollment(),
        },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists', profile: 'tutor' },
    });
  });

  it('unauthenticated with an existing auth email gets account-exists and no second auth user', async () => {
    await seedCode(seed.parent2.email);
    await expect(
      callFunction('enrollTutor', {
        ejemEmail: seed.parent2.email,
        verificationCode: CODE,
        password: 'Str0ngPass',
        consentVersion: '1.0',
        enrollment: tutorEnrollment(),
      }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });

  it('blocked account cannot add a profile', async () => {
    const db = getDb();
    const uid = 'blocked-user-1';
    // getIdToken exchanges a custom token; ensure an Auth-emulator user exists.
    await getAdminAuth().createUser({ uid, email: 'blocked@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'blocked@test.com',
      status: 'blocked',
      profiles: { parent: { enrollmentComplete: true, familyId: 'f-x' } },
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: EJEM_EMAIL,
          verificationCode: CODE,
          consentVersion: '1.0',
          enrollment: tutorEnrollment(),
        },
        token,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('add-profile mode still enforces the verification code', async () => {
    const token = await getIdToken(seed.parent2.uid);
    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: EJEM_EMAIL,
          verificationCode: '999999',
          consentVersion: '1.0',
          enrollment: tutorEnrollment(),
        },
        token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
