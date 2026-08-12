import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';

const EJEM_EMAIL = 'crossapp.sitter@ejm-test.org';
const CODE = '123456';
const TUTOR_UID = 'standalone-tutor-1';
const PARENT_UID = 'standalone-parent-1';

async function seedCode(email: string) {
  await getDb().collection('verificationCodes').doc(email.toLowerCase()).set({
    code: CODE,
    email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    createdAt: new Date(),
  });
}

describe('enrollBabysitter cross-app add-profile', () => {
  beforeAll(async () => {
    await clearAll();
    const db = getDb();
    // getIdToken exchanges a custom token; ensure an Auth-emulator user exists
    // (mirrors the blocked-user setup in cross-app-enroll-tutor.test.ts).
    await getAdminAuth().createUser({ uid: TUTOR_UID, email: 'tutoronly@test.com' });
    await db.collection('users').doc(TUTOR_UID).set({
      uid: TUTOR_UID,
      email: 'tutoronly@test.com',
      firstName: 'Tia',
      lastName: 'Tutor',
      status: 'active',
      language: 'fr',
      profiles: {
        tutor: { enrollmentComplete: true, ejemEmail: 'tutoronly@test.com', searchable: true },
      },
      consentVersion: '1.0',
    });
    // Pre-existing schedule with a marked slot — must survive the merge
    const slots = new Array(96).fill(false);
    const monday = [...slots];
    monday[40] = true;
    await db.collection('schedules').doc(TUTOR_UID).set({
      userId: TUTOR_UID,
      weekly: { mon: monday, tue: slots, wed: slots, thu: slots, fri: slots, sat: slots, sun: slots },
      overrides: {},
      holidayMode: 'same',
      updatedAt: new Date(),
    });

    await getAdminAuth().createUser({ uid: PARENT_UID, email: 'parentonly1@test.com' });
    await db.collection('users').doc(PARENT_UID).set({
      uid: PARENT_UID,
      email: 'parentonly1@test.com',
      firstName: 'Paula',
      lastName: 'Parent',
      status: 'active',
      language: 'en',
      profiles: {
        parent: { enrollmentComplete: true, familyId: 'f-parentonly' },
      },
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    await seedCode(EJEM_EMAIL);
  });

  it('adds a minimal profiles.babysitter to an authed tutor; tutor profile, base fields, schedule intact', async () => {
    const token = await getIdToken(TUTOR_UID);
    const result = await callFunction<{ success: boolean; uid: string }>(
      'enrollBabysitter',
      { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0' },
      token,
    );
    expect(result.uid).toBe(TUTOR_UID);

    const after = (await getDb().collection('users').doc(TUTOR_UID).get()).data()!;
    expect(after.profiles.babysitter).toEqual({
      enrollmentComplete: false,
      ejemEmail: EJEM_EMAIL.toLowerCase(),
      searchable: false,
    });
    expect(after.profiles.tutor.searchable).toBe(true);
    expect(after.firstName).toBe('Tia');
    expect(after.language).toBe('fr'); // fillBaseFields must NOT overwrite

    const sched = (await getDb().collection('schedules').doc(TUTOR_UID).get()).data()!;
    expect(sched.weekly.mon[40]).toBe(true);
  });

  it('rejects a parent adding a babysitter profile (role-exclusive, issue #116); no trace left', async () => {
    const db = getDb();
    const before = (await db.collection('users').doc(PARENT_UID).get()).data()!;

    const token = await getIdToken(PARENT_UID);
    await expect(
      callFunction(
        'enrollBabysitter',
        { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0' },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'role-exclusive', profile: 'babysitter' },
    });

    // The user doc gained no babysitter profile; the parent profile is
    // untouched.
    const after = (await db.collection('users').doc(PARENT_UID).get()).data()!;
    expect(after.profiles.babysitter).toBeUndefined();
    expect(after.profiles.parent).toEqual(before.profiles.parent);
    // No orphan schedules/{uid} grid: the preflight runs before the schedule
    // write, and parents never carry one.
    const schedule = await db.collection('schedules').doc(PARENT_UID).get();
    expect(schedule.exists).toBe(false);
  });

  it('rejects a second babysitter profile (profile-exists) — self-sufficient seeding', async () => {
    // Do NOT depend on the previous test: seed a dedicated user that already
    // has a babysitter profile.
    const db = getDb();
    const uid = 'already-sitter-1';
    await getAdminAuth().createUser({ uid, email: 'alreadysitter@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'alreadysitter@test.com',
      status: 'active',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'alreadysitter@test.com', searchable: true } },
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction(
        'enrollBabysitter',
        { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0' },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists', profile: 'babysitter' },
    });
  });

  it('unauthenticated with an existing auth email gets account-exists details', async () => {
    await seedCode('tutoronly@test.com');
    await expect(
      callFunction('enrollBabysitter', {
        ejemEmail: 'tutoronly@test.com',
        verificationCode: CODE,
        password: 'Str0ngPass1',
        consentVersion: '1.0',
      }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });
});
