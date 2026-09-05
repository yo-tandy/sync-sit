import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';

const EJEM_EMAIL = 'crossapp.sitter@ejm-test.org';
const CODE = '123456';
const TUTOR_UID = 'standalone-tutor-1';
const PARENT_UID = 'standalone-parent-1';

async function seedCode(email: string) {
  await getDb().collection('verificationCodes').doc(email.toLowerCase()).set({
    code: CODE,
    // The stamp verifyEjmEmail writes (issue #322): this enrollment is
    // EJM-gated and refuses a code without it.
    identityClass: 'ejm',
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

  it('unauthenticated with an existing auth email is rejected already-exists (race backstop)', async () => {
    await seedCode('tutoronly@test.com');
    await expect(
      callFunction('enrollBabysitter', {
        ejemEmail: 'tutoronly@test.com',
        verificationCode: CODE,
        password: 'Str0ngPass1',
        consentVersion: '1.0',
      }),
    ).rejects.toMatchObject({
      // Race-backstop throw: no machine-readable reason since the silent
      // existing-account flow (issue #148) removed the client branch.
      code: 'ALREADY_EXISTS',
    });
  });
});

// ── Frictionless cross-app switch (issue #144, owner clarification): no code,
// no email in the payload — the EJM identity derives from the caller's
// verified tutor profile, and shared profile fields are copied server-side. ──

describe('enrollBabysitter crossApp mode', () => {
  const RICH_TUTOR_UID = 'crossapp-rich-tutor';
  const CROSS_PARENT_UID = 'crossapp-parent-1';

  // Self-sufficient: the previous describe's afterAll cleared everything.
  beforeAll(async () => {
    const db = getDb();
    await getAdminAuth().createUser({ uid: CROSS_PARENT_UID, email: 'crossparent@test.com' });
    await db.collection('users').doc(CROSS_PARENT_UID).set({
      uid: CROSS_PARENT_UID,
      email: 'crossparent@test.com',
      firstName: 'Paula',
      lastName: 'Parent',
      status: 'active',
      profiles: { parent: { enrollmentComplete: true, familyId: 'f-crossparent' } },
    });
    await getAdminAuth().createUser({ uid: RICH_TUTOR_UID, email: 'richtutor@test.com' });
    await db.collection('users').doc(RICH_TUTOR_UID).set({
      uid: RICH_TUTOR_UID,
      email: 'richtutor@test.com',
      firstName: 'Rica',
      lastName: 'Tutor',
      dateOfBirth: '2008-05-01',
      status: 'active',
      language: 'fr',
      profiles: {
        tutor: {
          enrollmentComplete: true,
          ejemEmail: 'Rica.Tutor@EJM-Test.org', // mixed case: derivation must lowercase
          searchable: true,
          classLevel: '1ère',
          gender: 'female',
          contactEmail: 'rica@contact.com',
          contactPhone: '+33600000001',
          whatsapp: '+33600000001',
        },
      },
      consentVersion: '1.0',
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('succeeds with NO code doc and no ejemEmail in the payload; derives + copies from the tutor profile', async () => {
    const db = getDb();
    // Nothing seeded in verificationCodes for the derived email — the whole
    // point: mailbox ownership is not re-proven.
    const codeBefore = await db.collection('verificationCodes').doc('rica.tutor@ejm-test.org').get();
    expect(codeBefore.exists).toBe(false);

    const token = await getIdToken(RICH_TUTOR_UID);
    const result = await callFunction<{ success: boolean; uid: string }>(
      'enrollBabysitter',
      { crossApp: true, consentVersion: '1.0' },
      token,
    );
    expect(result.uid).toBe(RICH_TUTOR_UID);

    const after = (await db.collection('users').doc(RICH_TUTOR_UID).get()).data()!;
    // classLevel/gender are root-only fields now (issue #435 milestone, PR1)
    // — no longer copied onto the nested babysitter profile.
    expect(after.profiles.babysitter).toEqual({
      enrollmentComplete: false,
      ejemEmail: 'rica.tutor@ejm-test.org',
      searchable: false,
      contactEmail: 'rica@contact.com',
      contactPhone: '+33600000001',
      whatsapp: '+33600000001',
    });
    // Existing tutor profile and base fields untouched.
    expect(after.profiles.tutor.searchable).toBe(true);
    expect(after.profiles.tutor.classLevel).toBe('1ère');
    expect(after.firstName).toBe('Rica');
    expect(after.language).toBe('fr');
    // Canonical ROOT copies filled from the tutor profile (issue #203 shared
    // identity): fillBaseFields lifts them because the root was empty.
    expect(after.ejemEmail).toBe('rica.tutor@ejm-test.org');
    expect(after.contactEmail).toBe('rica@contact.com');
    expect(after.contactPhone).toBe('+33600000001');
    expect(after.whatsapp).toBe('+33600000001');
    // classLevel/gender lazily promoted to root (issue #435 milestone, PR1):
    // no separate backfill run needed for this caller.
    expect(after.classLevel).toBe('1ère');
    expect(after.gender).toBe('female');
  });

  // ── Issue #203 shared identity: root-canonical derivation ──

  it('derives from the ROOT ejemEmail when the nested tutor copy lacks it', async () => {
    const uid = 'crossapp-root-derive';
    const db = getDb();
    await getAdminAuth().createUser({ uid, email: 'rootderive@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'rootderive@test.com',
      firstName: 'Root', lastName: 'Derive', dateOfBirth: '2008-05-01',
      status: 'active',
      // Post-backfill shape: canonical root, nested copy already cleaned.
      ejemEmail: 'root.derive@ejm-test.org',
      contactPhone: '+33600000009',
      profiles: {
        tutor: { enrollmentComplete: true, searchable: false, classLevel: '2nde' },
      },
    });
    const token = await getIdToken(uid);
    const result = await callFunction<{ success: boolean; uid: string }>(
      'enrollBabysitter',
      { crossApp: true, consentVersion: '1.0' },
      token,
    );
    expect(result.uid).toBe(uid);
    const after = (await db.collection('users').doc(uid).get()).data()!;
    expect(after.profiles.babysitter.ejemEmail).toBe('root.derive@ejm-test.org');
    // Root contact resolves into the copied profile fields too.
    expect(after.profiles.babysitter.contactPhone).toBe('+33600000009');
    // Root stays untouched (fillBaseFields never overwrites populated fields).
    expect(after.ejemEmail).toBe('root.derive@ejm-test.org');
    expect(after.contactPhone).toBe('+33600000009');
    // classLevel only ever lived on the nested tutor profile for this caller
    // (no root, no backfill run) — fillBaseFields lazily promotes it here
    // (issue #435 milestone, PR1).
    expect(after.classLevel).toBe('2nde');
    expect(after.profiles.babysitter.classLevel).toBeUndefined();
  });

  it('a caller whose classLevel/gender already live at ROOT gets no copy step at all (issue #435 milestone, PR1)', async () => {
    // The whole point of promoting these fields to root: once they're there,
    // crossApp add-profile has nothing left to derive or copy — no dead
    // "copy from the other nested profile" step recreating the duplication.
    const uid = 'crossapp-already-root';
    const db = getDb();
    await getAdminAuth().createUser({ uid, email: 'alreadyroot@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'alreadyroot@test.com',
      firstName: 'Already', lastName: 'Root', dateOfBirth: '2008-05-01',
      status: 'active',
      ejemEmail: 'already.root@ejm-test.org',
      classLevel: 'Terminale',
      gender: 'other',
      profiles: {
        // The nested tutor profile carries a DIFFERENT (stale) value — the
        // root, not the nested copy, must win, since root is canonical.
        tutor: { enrollmentComplete: true, searchable: false, classLevel: '3ème', gender: 'male' },
      },
    });
    const token = await getIdToken(uid);
    await callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token);

    const after = (await db.collection('users').doc(uid).get()).data()!;
    // Root is untouched — fillBaseFields never overwrites a populated field.
    expect(after.classLevel).toBe('Terminale');
    expect(after.gender).toBe('other');
    // The new babysitter profile carries neither field at all.
    expect(after.profiles.babysitter.classLevel).toBeUndefined();
    expect(after.profiles.babysitter.gender).toBeUndefined();
  });

  it('channels the tutor never supplied are ABSENT at the root, not null', async () => {
    // A null here would read as a deliberate clear (root presence is
    // authoritative), blocking the nested fallback and the backfill —
    // the same defect round 6 removed from enrollTutor (PR #206 round 7).
    const uid = 'crossapp-sit-no-contact';
    const db = getDb();
    await getAdminAuth().createUser({ uid, email: 'sitnocontact@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'sitnocontact@test.com',
      firstName: 'No', lastName: 'Contact', dateOfBirth: '2008-05-01',
      status: 'active',
      ejemEmail: 'no.contact@ejm-test.org',
      profiles: {
        tutor: { enrollmentComplete: true, searchable: false, classLevel: '2nde' },
      },
    });
    const token = await getIdToken(uid);
    await callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token);

    const after = (await db.collection('users').doc(uid).get()).data()!;
    expect(after.contactEmail).toBeUndefined();
    expect(after.contactPhone).toBeUndefined();
    expect(after.whatsapp).toBeUndefined();
    // The nested profile keeps the null convention.
    expect(after.profiles.babysitter.contactEmail).toBeNull();
  });

  it('an explicitly CLEARED contact channel is not resurrected by cross-app enrollment', async () => {
    // Mirror of the tutor-side pin: a tutor who deleted their phone on the
    // study Account page (root null, nested copy frozen) must not get it
    // written back when they add a babysitter profile (PR #206 round 4).
    const uid = 'crossapp-sit-cleared';
    const db = getDb();
    await getAdminAuth().createUser({ uid, email: 'sitcleared@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'sitcleared@test.com',
      firstName: 'Cleared', lastName: 'Contact', dateOfBirth: '2008-05-01',
      status: 'active',
      ejemEmail: 'cleared.contact@ejm-test.org',
      contactPhone: null,
      contactEmail: 'kept@contact.com',
      profiles: {
        tutor: {
          enrollmentComplete: true, searchable: false, classLevel: '2nde',
          contactPhone: '+33600000009', contactEmail: 'kept@contact.com',
        },
      },
    });
    const token = await getIdToken(uid);
    await callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token);

    const after = (await db.collection('users').doc(uid).get()).data()!;
    expect(after.profiles.babysitter.contactPhone ?? null).toBeNull();
    expect(after.contactPhone ?? null).toBeNull();
    expect(after.profiles.tutor.contactPhone).toBe('+33600000009');
    expect(after.profiles.babysitter.contactEmail).toBe('kept@contact.com');
  });

  it('records crossApp provenance in the audit trail', async () => {
    const audit = await getDb()
      .collection('auditLogs')
      .where('adminUserId', '==', RICH_TUTOR_UID)
      .where('action', '==', 'babysitter_profile_added')
      .get();
    expect(audit.docs.some((d) => d.data().details?.crossApp === true)).toBe(true);
  });

  it('rejects a caller with NO provider profile (no verified EJM identity)', async () => {
    const uid = 'crossapp-bare-1';
    await getAdminAuth().createUser({ uid, email: 'bare1@test.com' });
    await getDb().collection('users').doc(uid).set({
      uid, email: 'bare1@test.com', status: 'active', profiles: {},
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a parent in crossApp mode (no tutor profile to derive from)', async () => {
    const token = await getIdToken(CROSS_PARENT_UID);
    await expect(
      callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    const after = (await getDb().collection('users').doc(CROSS_PARENT_UID).get()).data()!;
    expect(after.profiles.babysitter).toBeUndefined();
  });

  it('rejects crossApp when the caller already has a babysitter profile (profile-exists)', async () => {
    // RICH_TUTOR_UID gained a babysitter profile in the success test above.
    const token = await getIdToken(RICH_TUTOR_UID);
    await expect(
      callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0' }, token),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists', profile: 'babysitter' },
    });
  });

  it('rejects crossApp without consent', async () => {
    const token = await getIdToken(RICH_TUTOR_UID);
    await expect(
      callFunction('enrollBabysitter', { crossApp: true }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('unauthenticated crossApp is NOT a bypass: it falls through to the code-verified path', async () => {
    // crossApp only applies to signed-in callers; anonymous requests keep the
    // full email + code requirements.
    await expect(
      callFunction('enrollBabysitter', { crossApp: true, consentVersion: '1.0', password: 'Str0ngPass1' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
