import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// doEnrollDoer — the ABBREVIATED cross-app path (§3.3): a caller whose
// account already holds a COMPLETED sit/study PROVIDER profile adds
// profiles.doer with no email step, no code, no password. A parent profile
// does NOT qualify (§11.1 as corrected in PR #320 — any-domain
// self-signup). The §11.1 age gate still runs in full — in particular the
// unconditional DOB requirement, because the modal enrollee is a cross-app
// babysitter whose sit profile may well lack one — and so does the
// ≥1-contact-channel requirement (enrollTutor precedent, PR #320).

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

const CODE = '123456';

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

  it('a PARENT profile does NOT satisfy the identity gate (§11.1 as corrected in PR #320): any-domain self-signup proves no EJM affiliation', async () => {
    const token = await getIdToken(seed.parent1.uid);

    // Even a fully-formed payload is refused at the identity gate — before
    // DOB, contact or any other check ever runs.
    await expect(
      crossAppEnroll(token, { dateOfBirth: dobWithAge(40), contactEmail: 'marie@test.com' }),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    const user = (await getDb().collection('users').doc(seed.parent1.uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();
  });

  it('a parent-only account CAN still enroll through the code path\'s acceptance set — here the admin-preapproved carve-out (the owner-flippable V1 boundary)', async () => {
    // Round 2's domain gate admits exactly what verifyEjmEmail would issue
    // to: an EJM-valid address, or an admin-preapproved one. A parent
    // rarely holds the former, so the sanctioned route is preapproval —
    // seeded here the way addPreapprovedEmail writes it, plus the code doc.
    const email = 'parent.doer@invited.example.com';
    await getDb().collection('preapprovedEmails').doc(email).set({ email, used: false, createdAt: new Date() });
    await seedCode(email);
    const token = await getIdToken(seed.parent2.uid);

    const result = await callFunction<{ uid: string }>('doEnrollDoer', {
      ejemEmail: email,
      verificationCode: CODE,
      consentVersion: '2026-08-28',
      enrollment: { dateOfBirth: dobWithAge(40), contactEmail: 'pierre@test.com' },
    }, token);
    expect(result.uid).toBe(seed.parent2.uid);
    const user = (await getDb().collection('users').doc(seed.parent2.uid).get()).data()!;
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
    // The collected DOB is persisted to the root (the abbreviated flow must
    // be able to ask for it — §11.1); the parent profile is untouched.
    expect(user.dateOfBirth).toBeTruthy();
    expect(user.profiles.parent.familyId).toBe(seed.parent2.familyId);
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
      // A nested contact channel keeps the ≥1-contact requirement satisfied
      // so the AGE gate is what this case exercises.
      ejemEmail: 'legacy.sitter@ejm.org',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'legacy.sitter@ejm.org', contactEmail: 'legacy.sitter@ejm.org' } },
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

  it('a sit doc lacking BOTH a DOB and any contact channel is asked for each: DOB refusal, then contact refusal, then enrolls once supplied (root-persisted)', async () => {
    const uid = 'nodob-sitter';
    await getAdminAuth().createUser({ uid, email: 'nodob.sitter@ejm.org' });
    await getDb().collection('users').doc(uid).set({
      uid,
      email: 'nodob.sitter@ejm.org',
      status: 'active',
      firstName: 'NoDob',
      lastName: 'Sitter',
      // dateOfBirth deliberately absent — the pre-age-gate sit shape
      // (searchBabysitters.ts:205-206 documents these exist) — and NO
      // contact channel anywhere: sit's enrollment makes contact skippable
      // (issue #203), so this account shape is real, and PR #320's blocker
      // is exactly that it must not become a zero-channel doer.
      ejemEmail: 'nodob.sitter@ejm.org',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'nodob.sitter@ejm.org' } },
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await getIdToken(uid);

    // Contact requirement (checked before the age gate, the enrollTutor
    // order): a zero-channel account with no supplied channel is refused.
    await expect(crossAppEnroll(token, { dateOfBirth: dobWithAge(17) })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: 'At least one contact field is required',
    });

    // DOB requirement: contact supplied but no DOB anywhere is refused.
    await expect(crossAppEnroll(token, { contactEmail: 'nodob@test.com' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: 'Date of birth is required',
    });

    // No doer profile leaked from the refusals.
    let user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();

    const result = await crossAppEnroll(token, {
      dateOfBirth: dobWithAge(17),
      contactEmail: 'nodob@test.com',
    });
    expect(result.uid).toBe(uid);
    user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
    // Both collected values persist at the canonical root.
    expect(user.dateOfBirth).toBeTruthy();
    expect(user.contactEmail).toBe('nodob@test.com');
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

  it('contact-channel SHAPE is enforced at the callable (PR #320 round 3): junk email/phone/whatsapp refused, nothing written', async () => {
    // babysitter3: completed sit profile, DOB and nested contact on file —
    // every refusal below is purely the shape check, not the ≥1 requirement.
    const token = await getIdToken(seed.babysitter3.uid);

    await expect(
      crossAppEnroll(token, { contactEmail: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Invalid contact email' });

    await expect(
      crossAppEnroll(token, { contactPhone: 'call me maybe' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Invalid contact phone' });
    // Charset alone is not enough — too few digits is junk too.
    await expect(
      crossAppEnroll(token, { contactPhone: '+12' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Invalid contact phone' });

    await expect(
      crossAppEnroll(token, { whatsapp: 'zzz' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Invalid WhatsApp number' });

    const user = (await getDb().collection('users').doc(seed.babysitter3.uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();
    expect(user.contactEmail).toBeUndefined();
  });

  it('valid channel shapes are accepted per channel (whatsapp included)', async () => {
    const token = await getIdToken(seed.babysitter3.uid);
    const result = await crossAppEnroll(token, { whatsapp: '+33 6 11 22 33 44' });
    expect(result.uid).toBe(seed.babysitter3.uid);
    const user = (await getDb().collection('users').doc(seed.babysitter3.uid).get()).data()!;
    expect(user.whatsapp).toBe('+33 6 11 22 33 44');
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
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
