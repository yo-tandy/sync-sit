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

  it('rejects a sit parent adding a tutor profile (role-exclusive, issue #116); no trace left', async () => {
    const db = getDb();
    const token = await getIdToken(seed.parent1.uid);
    const before = (await db.collection('users').doc(seed.parent1.uid).get()).data()!;

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
      code: 'FAILED_PRECONDITION',
      details: { reason: 'role-exclusive', profile: 'tutor' },
    });

    // The user doc gained no tutor profile; the parent profile is untouched.
    const after = (await db.collection('users').doc(seed.parent1.uid).get()).data()!;
    expect(after.profiles.tutor).toBeUndefined();
    expect(after.profiles.parent).toEqual(before.profiles.parent);
    // No orphan schedules/{uid} grid: the preflight runs before the schedule
    // write, and parents never carry one.
    const schedule = await db.collection('schedules').doc(seed.parent1.uid).get();
    expect(schedule.exists).toBe(false);
  });

  it('adds profiles.tutor to an authed sit babysitter (student↔student survives); no clobbering', async () => {
    const db = getDb();
    const token = await getIdToken(seed.babysitter1.uid);
    const before = (await db.collection('users').doc(seed.babysitter1.uid).get()).data()!;
    // babysitter1 has a seeded schedule grid with marked slots.
    const slotsBefore = (await db.collection('schedules').doc(seed.babysitter1.uid).get()).data()!;

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
    expect(result.uid).toBe(seed.babysitter1.uid);

    const after = (await db.collection('users').doc(seed.babysitter1.uid).get()).data()!;
    // New tutor profile with the verified EJM email inside it
    expect(after.profiles.tutor.ejemEmail).toBe(EJEM_EMAIL.toLowerCase());
    expect(after.profiles.tutor.enrollmentComplete).toBe(false);
    expect(after.profiles.tutor.searchable).toBe(false);
    expect(after.profiles.tutor.verification).toEqual({ identityStatus: 'not_submitted' });
    expect(after.profiles.tutor.subjects).toHaveLength(1);
    // Existing profile untouched
    expect(after.profiles.babysitter).toEqual(before.profiles.babysitter);
    // Existing base fields win over conflicting wizard values
    expect(after.firstName).toBe(before.firstName);
    expect(after.email).toBe(before.email);
    // Consent not overwritten
    expect(after.consentVersion).toBe(before.consentVersion);
    // Existing schedule grid not clobbered by ensureScheduleDoc
    const slotsAfter = (await db.collection('schedules').doc(seed.babysitter1.uid).get()).data()!;
    expect(slotsAfter.weekly).toEqual(slotsBefore.weekly);
    // Code consumed
    const codeDoc = await db
      .collection('verificationCodes')
      .doc(EJEM_EMAIL.toLowerCase())
      .get();
    expect(codeDoc.exists).toBe(false);
  });

  it('rejects when the caller already has a tutor profile (profile-exists)', async () => {
    const token = await getIdToken(seed.tutor1.uid); // seeded with a tutor profile
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
    // A babysitter profile keeps the caller otherwise legal, so blocked status
    // is the only possible rejection cause.
    await getAdminAuth().createUser({ uid, email: 'blocked@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'blocked@test.com',
      status: 'blocked',
      profiles: { babysitter: { enrollmentComplete: true, searchable: false } },
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

  // ── Issue #144: the wizard omits identity for cross-app enrollees ──

  it('add-profile succeeds with NO identity in the payload; stored identity untouched', async () => {
    const db = getDb();
    const token = await getIdToken(seed.babysitter3.uid);
    const before = (await db.collection('users').doc(seed.babysitter3.uid).get()).data()!;

    const payload = tutorEnrollment() as Record<string, unknown>;
    delete payload.firstName;
    delete payload.lastName;
    delete payload.dateOfBirth;

    const result = await callFunction<{ uid: string }>(
      'enrollTutor',
      { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0', enrollment: payload },
      token,
    );
    expect(result.uid).toBe(seed.babysitter3.uid);

    const after = (await db.collection('users').doc(seed.babysitter3.uid).get()).data()!;
    expect(after.firstName).toBe(before.firstName);
    expect(after.lastName).toBe(before.lastName);
    expect(after.dateOfBirth).toEqual(before.dateOfBirth);
    expect(after.profiles.tutor.ejemEmail).toBe(EJEM_EMAIL.toLowerCase());
  });

  it('rejects when identity is on file NOWHERE (no payload, no doc)', async () => {
    // A bare authed account with no identity anywhere must be told to
    // supply it — the presence check covers payload OR existing doc.
    const auth = getAdminAuth();
    const bare = await auth.createUser({
      email: 'bare.identity144@ejm-test.org',
      password: 'test1234',
    });
    await getDb().collection('users').doc(bare.uid).set({
      uid: bare.uid,
      email: 'bare.identity144@ejm-test.org',
      status: 'active',
      profiles: {},
    });
    const token = await getIdToken(bare.uid);

    const payload = tutorEnrollment() as Record<string, unknown>;
    delete payload.firstName;
    delete payload.lastName;
    delete payload.dateOfBirth;

    await expect(
      callFunction(
        'enrollTutor',
        { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0', enrollment: payload },
        token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('the age gate runs against the STORED DoB, not the payload', async () => {
    // Underage stored DoB (14) + payload omitting identity: the gate must
    // read the trusted doc value and reject, even though the payload has
    // nothing to gate on. Email carries the matching graduation cohort so
    // the gate actually runs (no grad year -> gate skipped by design).
    const schoolYearEnd = new Date().getMonth() >= 8
      ? new Date().getFullYear() + 1
      : new Date().getFullYear();
    // Expected-age-15 cohort (a 14yo's own cohort year is outside the valid
    // email window) — same shape as tutor-age-gate test (a), but with the
    // underage DoB stored on the DOC, not in the payload.
    const grad14 = String((schoolYearEnd + (18 - 15)) % 100).padStart(2, '0');
    const d = new Date();
    let y = d.getFullYear();
    let m = d.getMonth() - 5;
    if (m < 0) { m += 12; y -= 1; }
    const storedDob14 = `${y - 14}-${String(m + 1).padStart(2, '0')}-15`;
    const gateEmail = `storedgate.g${grad14}@ejm.org`;
    await seedCode(gateEmail);

    const auth = getAdminAuth();
    const young = await auth.createUser({
      email: 'young.identity144@ejm-test.org',
      password: 'test1234',
    });
    await getDb().collection('users').doc(young.uid).set({
      uid: young.uid,
      email: 'young.identity144@ejm-test.org',
      firstName: 'Too',
      lastName: 'Young',
      dateOfBirth: storedDob14,
      status: 'active',
      profiles: {},
    });
    const token = await getIdToken(young.uid);

    const payload = tutorEnrollment() as Record<string, unknown>;
    delete payload.firstName;
    delete payload.lastName;
    delete payload.dateOfBirth;

    await expect(
      callFunction(
        'enrollTutor',
        { ejemEmail: gateEmail, verificationCode: CODE, consentVersion: '1.0', enrollment: payload },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
  });

  it('add-profile mode still enforces the verification code', async () => {
    // babysitter2 has no tutor profile — a legal caller, so only the wrong
    // code can reject.
    const token = await getIdToken(seed.babysitter2.uid);
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
