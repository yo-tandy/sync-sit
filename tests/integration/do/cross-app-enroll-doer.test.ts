import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// doEnrollDoer — the ABBREVIATED cross-app path (§3.3): a caller whose
// account already holds a COMPLETED sit/study provider or parent profile
// adds profiles.doer with no email step, no code, no password. The §11.1
// age gate still runs in full — in particular the unconditional DOB
// requirement, because the modal enrollee is a cross-app babysitter whose
// sit profile may well lack one.

function dobWithAge(age: number): string {
  const d = new Date();
  let y = d.getFullYear();
  let m = d.getMonth() - 5;
  if (m < 0) {
    m += 12;
    y -= 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y - age}-${pad(m + 1)}-15`;
}

function crossAppEnroll(token: string, enrollment: Record<string, unknown> = {}, consentVersion = '2026-08-28') {
  return callFunction<{ uid: string }>(
    'doEnrollDoer',
    { crossApp: true, consentVersion, enrollment },
    token,
  );
}

describe('doEnrollDoer — abbreviated cross-app path (§3.3)', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  it('a completed SIT babysitter adds a doer profile with the minimal payload; defaults land; consent is recorded', async () => {
    const token = await getIdToken(seed.babysitter1.uid);
    const before = (await getDb().collection('users').doc(seed.babysitter1.uid).get()).data()!;

    const result = await crossAppEnroll(token, { bio: 'Handy with a screwdriver.' });
    expect(result.uid).toBe(seed.babysitter1.uid);

    const user = (await getDb().collection('users').doc(seed.babysitter1.uid).get()).data()!;
    expect(user.profiles.doer).toMatchObject({
      enrollmentComplete: true,
      notifyNewTasks: true,
      bio: 'Handy with a screwdriver.',
      hasCar: false,
      hasBike: false,
      defaultRate: null,
    });
    expect(user.profiles.doer.categories).toHaveLength(7);
    // The sit profile and root identity are untouched.
    expect(user.profiles.babysitter).toEqual(before.profiles.babysitter);
    expect(user.firstName).toBe(before.firstName);
    // §11.4: the abbreviated enrollment still records consent for the
    // sync-do terms.
    expect(user.consentVersion).toBe('2026-08-28');
    expect(user.consentAt).toBeTruthy();
    // Decision 10: no schedule side effects (babysitter1 already has one —
    // it must remain exactly the sit-owned doc, not be recreated; the real
    // assertion is on the new-account path, this one pins no crash).
  });

  it('a completed STUDY tutor adds a doer profile the same way', async () => {
    // tutor2: the seed's ENROLLED tutor (tutor1 is deliberately the legacy
    // enrollmentComplete:false shape — covered by the incomplete-profile
    // case below).
    const token = await getIdToken(seed.tutor2.uid);
    const result = await crossAppEnroll(token, {
      categories: ['it', 'errands'],
      hasBike: true,
      notifyNewTasks: false,
    });
    expect(result.uid).toBe(seed.tutor2.uid);

    const user = (await getDb().collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(user.profiles.doer).toMatchObject({
      enrollmentComplete: true,
      notifyNewTasks: false,
      categories: ['it', 'errands'],
      hasBike: true,
    });
    expect(user.profiles.tutor.enrollmentComplete).toBe(true);
  });

  it('a LEGACY incomplete tutor doc (enrollmentComplete: false) does NOT satisfy the identity gate', async () => {
    const token = await getIdToken(seed.tutor1.uid);
    await expect(crossAppEnroll(token, {})).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    const user = (await getDb().collection('users').doc(seed.tutor1.uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();
  });

  it('a completed PARENT profile satisfies the identity gate (§8), but the DOB requirement still binds: refused without one, enrolls with one', async () => {
    const token = await getIdToken(seed.parent1.uid);

    // Seed parents carry no dateOfBirth — the §11.1 unconditional DOB
    // requirement fires as invalid-argument, not as a governance branch.
    await expect(crossAppEnroll(token, {})).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });

    const result = await crossAppEnroll(token, { dateOfBirth: dobWithAge(40) });
    expect(result.uid).toBe(seed.parent1.uid);
    const user = (await getDb().collection('users').doc(seed.parent1.uid).get()).data()!;
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
    // The collected DOB is persisted to the root (the abbreviated flow must
    // be able to ask for it — §11.1).
    expect(user.dateOfBirth).toBeTruthy();
    // The parent profile is untouched.
    expect(user.profiles.parent.familyId).toBe(seed.parent1.familyId);
  });

  it('the under-15 floor holds on the DOB ALONE for a legacy cross-app account whose stored email cannot parse (§11.1 pin, crossApp variant)', async () => {
    const uid = 'legacy-sitter-14';
    await getAdminAuth().createUser({ uid, email: 'legacy.sitter@ejm.org' });
    await getDb().collection('users').doc(uid).set({
      uid,
      email: 'legacy.sitter@ejm.org',
      status: 'active',
      firstName: 'Legacy',
      lastName: 'Sitter',
      dateOfBirth: new Date(dobWithAge(14)),
      // No trailing grad-year digits — validateEjmEmail cannot parse it;
      // enrollTutor's email-guarded floor shape would stand down here.
      ejemEmail: 'legacy.sitter@ejm.org',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'legacy.sitter@ejm.org' } },
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await getIdToken(uid);

    await expect(crossAppEnroll(token, {})).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'under_15' },
    });
    const user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();
  });

  it('a doc whose sit profile lacks a DOB is asked for one: refused without, enrolled (and root-persisted) with', async () => {
    const uid = 'nodob-sitter';
    await getAdminAuth().createUser({ uid, email: 'nodob.sitter@ejm.org' });
    await getDb().collection('users').doc(uid).set({
      uid,
      email: 'nodob.sitter@ejm.org',
      status: 'active',
      firstName: 'NoDob',
      lastName: 'Sitter',
      // dateOfBirth deliberately absent — the pre-age-gate sit shape
      // (searchBabysitters.ts:205-206 documents these exist).
      ejemEmail: 'nodob.sitter@ejm.org',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'nodob.sitter@ejm.org' } },
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await getIdToken(uid);

    await expect(crossAppEnroll(token, {})).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });

    const result = await crossAppEnroll(token, { dateOfBirth: dobWithAge(17) });
    expect(result.uid).toBe(uid);
    const user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
    expect(user.dateOfBirth).toBeTruthy();
  });

  it('an INCOMPLETE provider profile proves nothing: refused, no doer profile written (the §14 no-verified-identity pin)', async () => {
    const uid = 'halfway-sitter';
    await getAdminAuth().createUser({ uid, email: 'halfway.sitter@ejm.org' });
    await getDb().collection('users').doc(uid).set({
      uid,
      email: 'halfway.sitter@ejm.org',
      status: 'active',
      firstName: 'Halfway',
      lastName: 'Sitter',
      dateOfBirth: new Date(dobWithAge(17)),
      // Sit creates its babysitter profile with enrollmentComplete: false
      // and completes it later — an abandoned half-enrollment must not
      // satisfy the identity gate.
      profiles: { babysitter: { enrollmentComplete: false, ejemEmail: 'halfway.sitter@ejm.org' } },
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await getIdToken(uid);

    await expect(crossAppEnroll(token, {})).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    const user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();
  });

  it('re-enrolling is refused profile-exists, leaving the first profile intact', async () => {
    const token = await getIdToken(seed.babysitter1.uid);
    await expect(crossAppEnroll(token, {})).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists' },
    });
    const user = (await getDb().collection('users').doc(seed.babysitter1.uid).get()).data()!;
    expect(user.profiles.doer.bio).toBe('Handy with a screwdriver.');
  });

  it('a blocked account cannot enroll', async () => {
    const token = await getIdToken(seed.babysitter2.uid);
    await getDb().collection('users').doc(seed.babysitter2.uid).update({ status: 'blocked' });
    try {
      await expect(crossAppEnroll(token, {})).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    } finally {
      await getDb().collection('users').doc(seed.babysitter2.uid).update({ status: 'active' });
    }
  });

  it('a contact channel typed in the wizard is written to the canonical root', async () => {
    const token = await getIdToken(seed.babysitter2.uid);
    const result = await crossAppEnroll(token, { contactPhone: '+33 655555555' });
    expect(result.uid).toBe(seed.babysitter2.uid);
    const user = (await getDb().collection('users').doc(seed.babysitter2.uid).get()).data()!;
    expect(user.contactPhone).toBe('+33 655555555');
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
  });
});
