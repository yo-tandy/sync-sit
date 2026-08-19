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
    // Complete at creation (owner decision 2026-08-17), no verification state.
    expect(after.profiles.tutor.enrollmentComplete).toBe(true);
    expect(after.profiles.tutor.searchable).toBe(false);
    expect(after.profiles.tutor.verification).toBeUndefined();
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

  it('unauthenticated with an existing auth email is rejected already-exists and no second auth user (race backstop)', async () => {
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
      // Race-backstop throw: no machine-readable reason since the silent
      // existing-account flow (issue #148) removed the client branch.
      code: 'ALREADY_EXISTS',
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

  it("fillBaseFields repairs an EMPTY ('') identity field from the payload", async () => {
    // The fill condition widened from strictly-undefined to empty
    // (undefined/null/'') — pin it end to end: a doc holding firstName ''
    // plus a payload carrying the value gets repaired; populated fields win.
    const auth = getAdminAuth();
    const empty = await auth.createUser({
      email: 'empty.identity144@ejm-test.org',
      password: 'test1234',
    });
    await getDb().collection('users').doc(empty.uid).set({
      uid: empty.uid,
      email: 'empty.identity144@ejm-test.org',
      firstName: '',
      lastName: 'Kept',
      dateOfBirth: '2007-03-15',
      status: 'active',
      profiles: {},
    });
    const token = await getIdToken(empty.uid);

    const payload = tutorEnrollment({ lastName: 'Ignored' }) as Record<string, unknown>;
    await callFunction(
      'enrollTutor',
      { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0', enrollment: payload },
      token,
    );

    const after = (await getDb().collection('users').doc(empty.uid).get()).data()!;
    expect(after.firstName).toBe('Wizard');
    expect(after.lastName).toBe('Kept');
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

// ── Frictionless cross-app switch (issue #144, owner clarification): no code,
// no email, no identity, no prefs in the payload — only subjects. The EJM
// identity derives from the caller's verified babysitter profile; shared
// profile fields are copied server-side; prefs get the server defaults. ──

describe('enrollTutor crossApp mode', () => {
  const RICH_SITTER_UID = 'crossapp-rich-sitter';
  const SUBJECTS = [{ subject: 'math', levels: ['CP'], rate: 22 }];

  async function seedSitter(uid: string, email: string, overrides: Record<string, unknown> = {}) {
    await getAdminAuth().createUser({ uid, email });
    await getDb().collection('users').doc(uid).set({
      uid,
      email,
      firstName: 'Sacha',
      lastName: 'Sitter',
      dateOfBirth: '2008-04-01',
      status: 'active',
      profiles: {
        babysitter: {
          enrollmentComplete: true,
          ejemEmail: email,
          searchable: true,
          classLevel: '2nde',
          gender: 'other',
          contactEmail: 'sacha@contact.com',
          contactPhone: '+33600000002',
        },
      },
      ...overrides,
    });
  }

  beforeAll(async () => {
    await clearAll();
    // Non-grad-year email: the age gate stands down by design (legacy shape),
    // isolating these pins from cohort math. The stored-DoB gate keeps its own
    // dedicated pin below.
    await seedSitter(RICH_SITTER_UID, 'richsitter@test.com');
  });

  afterAll(async () => {
    await clearAll();
  });

  it('succeeds with ONLY subjects: derives ejemEmail, copies shared fields, applies pref defaults', async () => {
    const db = getDb();
    const codeBefore = await db.collection('verificationCodes').doc('richsitter@test.com').get();
    expect(codeBefore.exists).toBe(false);

    const token = await getIdToken(RICH_SITTER_UID);
    const result = await callFunction<{ uid: string }>(
      'enrollTutor',
      { crossApp: true, consentVersion: '1.0', subjects: SUBJECTS },
      token,
    );
    expect(result.uid).toBe(RICH_SITTER_UID);

    const after = (await db.collection('users').doc(RICH_SITTER_UID).get()).data()!;
    const tutor = after.profiles.tutor;
    expect(tutor.ejemEmail).toBe('richsitter@test.com');
    // Complete at creation (owner decision 2026-08-17), no verification state.
    expect(tutor.enrollmentComplete).toBe(true);
    expect(tutor.searchable).toBe(false);
    expect(tutor.verification).toBeUndefined();
    expect(tutor.subjects).toEqual(SUBJECTS);
    // Copied from the babysitter profile:
    expect(tutor.classLevel).toBe('2nde');
    expect(tutor.gender).toBe('other');
    expect(tutor.contactEmail).toBe('sacha@contact.com');
    expect(tutor.contactPhone).toBe('+33600000002');
    // Server pref defaults (issue #143):
    expect(tutor.sessionLengthsMin).toEqual([60]);
    expect(tutor.paddingMin).toBe(30);
    expect(tutor.areaMode).toBe('arrondissement');
    // Babysitter profile and root identity untouched.
    expect(after.profiles.babysitter.searchable).toBe(true);
    expect(after.firstName).toBe('Sacha');
    // Canonical ROOT copies filled from the babysitter profile (issue #203
    // shared identity): fillBaseFields lifts them because the root was empty.
    expect(after.ejemEmail).toBe('richsitter@test.com');
    expect(after.contactEmail).toBe('sacha@contact.com');
    expect(after.contactPhone).toBe('+33600000002');
  });

  // ── Issue #203 shared identity: root-canonical derivation ──

  it('derives from the ROOT ejemEmail when the nested babysitter copy lacks it', async () => {
    const uid = 'crossapp-root-derive-t';
    const db = getDb();
    await getAdminAuth().createUser({ uid, email: 'rootderivet@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'rootderivet@test.com',
      firstName: 'Root', lastName: 'Derive', dateOfBirth: '2008-04-01',
      status: 'active',
      // Post-backfill shape: canonical root, nested copy already cleaned.
      ejemEmail: 'root.derive.t@ejm-test.org',
      contactEmail: 'roott@contact.com',
      profiles: {
        babysitter: { enrollmentComplete: true, searchable: false, classLevel: '2nde' },
      },
    });
    const token = await getIdToken(uid);
    const result = await callFunction<{ uid: string }>(
      'enrollTutor',
      { crossApp: true, consentVersion: '1.0', subjects: SUBJECTS },
      token,
    );
    expect(result.uid).toBe(uid);
    const after = (await db.collection('users').doc(uid).get()).data()!;
    expect(after.profiles.tutor.ejemEmail).toBe('root.derive.t@ejm-test.org');
    // Root contact resolves into the synthesized enrollment (contact floor met
    // by the ROOT field alone).
    expect(after.profiles.tutor.contactEmail).toBe('roott@contact.com');
    // Root stays untouched (fillBaseFields never overwrites populated fields).
    expect(after.ejemEmail).toBe('root.derive.t@ejm-test.org');
    expect(after.contactEmail).toBe('roott@contact.com');
  });

  it('records crossApp provenance in the audit trail', async () => {
    const audit = await getDb()
      .collection('auditLogs')
      .where('adminUserId', '==', RICH_SITTER_UID)
      .where('action', '==', 'tutor.profile_added')
      .get();
    expect(audit.docs.some((d) => d.data().details?.crossApp === true)).toBe(true);
  });

  it('rejects a caller with NO provider profile (no verified EJM identity)', async () => {
    const uid = 'crossapp-bare-tutor';
    await getAdminAuth().createUser({ uid, email: 'baretutor@test.com' });
    await getDb().collection('users').doc(uid).set({
      uid, email: 'baretutor@test.com', status: 'active', profiles: {},
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction('enrollTutor', { crossApp: true, consentVersion: '1.0', subjects: SUBJECTS }, token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('enforces the subjects floor (empty array rejected)', async () => {
    const uid = 'crossapp-nosubjects';
    await seedSitter(uid, 'nosubjects@test.com');
    const token = await getIdToken(uid);
    await expect(
      callFunction('enrollTutor', { crossApp: true, consentVersion: '1.0', subjects: [] }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('still requires a contact field: a contactless babysitter profile is rejected', async () => {
    // Edge stated in the report: a babysitter who never finished sit
    // enrollment has no contact to copy — the tutor contact invariant holds.
    const uid = 'crossapp-nocontact';
    await getAdminAuth().createUser({ uid, email: 'nocontact@test.com' });
    await getDb().collection('users').doc(uid).set({
      uid,
      email: 'nocontact@test.com',
      firstName: 'No', lastName: 'Contact', dateOfBirth: '2008-04-01',
      status: 'active',
      profiles: {
        babysitter: { enrollmentComplete: false, ejemEmail: 'nocontact@test.com', searchable: false, classLevel: '2nde' },
      },
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction('enrollTutor', { crossApp: true, consentVersion: '1.0', subjects: SUBJECTS }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('the stored-DoB age gate still runs in crossApp mode (under-15 rejected)', async () => {
    // Derived EJM email carries a graduation year; the stored DoB is 14 —
    // the gate must reject even though the payload carries no DoB at all.
    const schoolYearEnd = new Date().getMonth() >= 8
      ? new Date().getFullYear() + 1
      : new Date().getFullYear();
    const grad14 = String((schoolYearEnd + (18 - 15)) % 100).padStart(2, '0');
    const d = new Date();
    let y = d.getFullYear();
    let m = d.getMonth() - 5;
    if (m < 0) { m += 12; y -= 1; }
    const storedDob14 = `${y - 14}-${String(m + 1).padStart(2, '0')}-15`;
    const gateEmail = `crossgate.g${grad14}@ejm.org`;

    const uid = 'crossapp-young';
    await getAdminAuth().createUser({ uid, email: 'crossyoung@test.com' });
    await getDb().collection('users').doc(uid).set({
      uid,
      email: 'crossyoung@test.com',
      firstName: 'Too', lastName: 'Young', dateOfBirth: storedDob14,
      status: 'active',
      profiles: {
        babysitter: {
          enrollmentComplete: true, ejemEmail: gateEmail, searchable: true,
          classLevel: '2nde', contactEmail: 'young@contact.com',
        },
      },
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction('enrollTutor', { crossApp: true, consentVersion: '1.0', subjects: SUBJECTS }, token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
  });
});
