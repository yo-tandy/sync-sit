import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// doEnrollDoer — the §14 enrollment matrix, classic (code-verified) paths.
// The §11.1 age gate runs against the REAL clock, so fixtures are computed
// relative to today (the tutor-age-gate idiom).

const CODE = '123456';

/** Calendar year the current school year ends in (September boundary, local). */
function schoolYearEnd(): number {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}

/** 2-digit graduation year whose cohort has the given expected age today. */
function gradYearForExpectedAge(expectedAge: number): number {
  return (schoolYearEnd() + (18 - expectedAge)) % 100;
}

/** A "YYYY-MM-DD" DOB for someone who turned `age` about five months ago. */
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

/** An admin-preapproved address (test/invite accounts) — the shape
 *  addPreapprovedEmail writes and the round-2 domain gate reads. */
async function seedPreapproved(email: string) {
  await getDb()
    .collection('preapprovedEmails')
    .doc(email.toLowerCase())
    .set({ email: email.toLowerCase(), used: false, createdAt: new Date() });
}

function doerEnrollment(dateOfBirth: string | undefined, overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Gate',
    lastName: 'Case',
    ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
    contactEmail: 'gate@test.com',
    ...overrides,
  };
}

function enroll(
  ejemEmail: string,
  enrollment: Record<string, unknown>,
  token?: string,
) {
  return callFunction<{ uid: string }>(
    'doEnrollDoer',
    {
      ejemEmail,
      verificationCode: CODE,
      ...(token ? {} : { password: 'Str0ngPass1' }),
      consentVersion: '1.0',
      enrollment,
    },
    token,
  );
}

describe('doEnrollDoer — classic path, identity + age gates (§8, §11.1)', () => {
  let seed: SeedData;
  let adminToken: string;

  const GRAD_15 = gradYearForExpectedAge(15);
  const GRAD_16 = gradYearForExpectedAge(16);

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('enrolls a consistent 16-year-old: profile complete, ALL categories, no schedule doc', async () => {
    const email = `fine.a${GRAD_16}@ejm.org`;
    await seedCode(email);
    const result = await enroll(email, doerEnrollment(dobWithAge(16)));
    expect(result.uid).toBeTruthy();

    const user = (await getDb().collection('users').doc(result.uid).get()).data()!;
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
    // Categories default to ALL seven — the modal intent stated as data
    // (§3.3: an empty array must mean "no digests", never "all").
    expect(user.profiles.doer.categories).toHaveLength(7);
    expect(user.profiles.doer.notifyNewTasks).toBe(true);
    // Root identity written; consent recorded (§11.4).
    expect(user.ejemEmail).toBe(email);
    expect(user.consentVersion).toBe('1.0');
    expect(user.consentAt).toBeTruthy();
    // The code was consumed.
    expect((await getDb().collection('verificationCodes').doc(email).get()).exists).toBe(false);
    // Decision 10: sync-do never touches schedules — enrollment must NOT
    // create a schedules/{uid} doc the way sit/study enrollment does.
    expect((await getDb().collection('schedules').doc(result.uid).get()).exists).toBe(false);
  });

  it('refuses an UNGOVERNED 14-year-old: failed-precondition, reason under_15', async () => {
    const email = `young.b${GRAD_15}@ejm.org`;
    await seedCode(email);
    await expect(enroll(email, doerEnrollment(dobWithAge(14)))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'under_15', code: 'age/under-15' },
    });
  });

  it('the §11.1 deviation pin: ungoverned under-15 with a VALID DOB and a code-accepted email that yields NO graduation year is still refused under_15', async () => {
    // enrollTutor.ts:263 guards its floor on the email parsing — copied
    // verbatim, a 14-year-old whose accepted address yields no grad year
    // would walk straight through. The floor must hold on the DOB alone.
    // Since round 2's domain gate, the classic path's only no-grad-year
    // acceptances are admin-preapproved addresses — so the fixture is one
    // (the crossApp variant of this pin covers legacy stored emails).
    const email = 'legacy.doer@ejm.org'; // no trailing grad-year digits
    await seedPreapproved(email);
    await seedCode(email);
    await expect(enroll(email, doerEnrollment(dobWithAge(14)))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'under_15' },
    });
  });

  it('issue #322 pin: a NON-EJM address with a VALID minted code is refused BEFORE the code is consulted (not_ejm_email)', async () => {
    // verifyParentEmail (public, any-domain) writes the SAME
    // verificationCodes/{email} namespace — seed exactly the doc it would
    // mint. Without the domain gate this payload would land an active
    // account with profiles.doer.enrollmentComplete: true, i.e. the §7.2
    // board audience would be "anyone with a mailbox".
    const email = 'attacker@gmail.com';
    await seedCode(email);
    await expect(enroll(email, doerEnrollment(dobWithAge(30)))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'not_ejm_email' },
    });
    // No account was created for the address.
    const users = await getDb().collection('users').where('email', '==', email).get();
    expect(users.empty).toBe(true);
  });

  it('issue #322 pin, used-up carve-out: a preapproved address with used: true is refused too (the exact verifyEjmEmail acceptance set)', async () => {
    const email = 'spent.invite@gmail.com';
    await getDb().collection('preapprovedEmails').doc(email).set({ email, used: true });
    await seedCode(email);
    await expect(enroll(email, doerEnrollment(dobWithAge(30)))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'not_ejm_email' },
    });
  });

  it('refuses ANY caller with a missing DOB: invalid-argument, before any governance branch', async () => {
    const email = `nodob.c${GRAD_16}@ejm.org`;
    await seedCode(email);
    await expect(enroll(email, doerEnrollment(undefined))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('refuses an unparseable DOB: invalid-argument', async () => {
    const email = `baddob.d${GRAD_16}@ejm.org`;
    await seedCode(email);
    await expect(
      enroll(email, doerEnrollment('2010-13-45')),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('age_mismatch half: DOB far off the email cohort is refused, and an admin exemption waives it', async () => {
    const email = `mismatch.e${GRAD_15}@ejm.org`;
    await seedCode(email);
    await expect(enroll(email, doerEnrollment(dobWithAge(21)))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'age_mismatch', code: 'age/mismatch' },
    });

    await callFunction('setEnrollmentExemption', { email, note: 'verified by admin' }, adminToken);
    await seedCode(email);
    const result = await enroll(email, doerEnrollment(dobWithAge(21)));
    expect(result.uid).toBeTruthy();
  });

  it('an exemption NEVER waives the under-15 floor', async () => {
    const email = `floor.f${GRAD_15}@ejm.org`;
    await callFunction('setEnrollmentExemption', { email, note: 'should not matter' }, adminToken);
    await seedCode(email);
    await expect(enroll(email, doerEnrollment(dobWithAge(14)))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'under_15' },
    });
  });

  it('identity gate: an authenticated account with NO completed profile claiming crossApp is refused, and never reaches enrollmentComplete', async () => {
    // The §11.1 clause the §7.2 board read rule depends on: a server-owned
    // flag any authenticated account could earn without an identity check
    // would protect nothing.
    const uid = 'no-identity-1';
    await getAdminAuth().createUser({ uid, email: 'no.identity1@test.com' });
    await getDb().collection('users').doc(uid).set({
      uid,
      email: 'no.identity1@test.com',
      status: 'active',
      firstName: 'No',
      lastName: 'Identity',
      dateOfBirth: new Date(dobWithAge(17)),
      profiles: {},
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await getIdToken(uid);

    await expect(
      callFunction('doEnrollDoer', {
        crossApp: true,
        consentVersion: '1.0',
        enrollment: doerEnrollment(dobWithAge(17)),
      }, token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    const user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();
  });

  it('identity gate: the same account with a WRONG code is refused on the code-verified path too', async () => {
    const uid = 'no-identity-1';
    const email = `codegate.g${GRAD_16}@ejm.org`;
    await seedCode(email);
    const token = await getIdToken(uid);

    await expect(
      callFunction('doEnrollDoer', {
        ejemEmail: email,
        verificationCode: '999999',
        consentVersion: '1.0',
        enrollment: doerEnrollment(dobWithAge(17)),
      }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    const user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.profiles.doer).toBeUndefined();
  });

  describe('governed accounts (the §11.1 carve-out and its revocation edge)', () => {
    /** A kid user doc as redeemKidInvite would have created it. */
    async function seedGovernedKid(uid: string, email: string, age: number) {
      await getAdminAuth().createUser({ uid, email });
      await getDb().collection('users').doc(uid).set({
        uid,
        email: email.toLowerCase(),
        status: 'active',
        firstName: 'Gate',
        lastName: 'Kid',
        dateOfBirth: new Date(dobWithAge(age)),
        language: 'en',
        identityLocked: true,
        governedBy: { familyId: 'family-dupont', linkedAt: new Date() },
        profiles: {},
        notifPrefs: {},
        fcmTokens: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await getDb().collection('guardianLinks').doc(uid).set({
        childUid: uid,
        familyId: 'family-dupont',
        createdByParentUid: seed.parent1.uid,
        status: 'active',
        origin: 'parent_created',
        requestedAt: new Date(),
        confirmedAt: new Date(),
        consent: {
          tosVersion: '1.0',
          privacyVersion: '1.0',
          supervisionAgreementVersion: '1.0',
          approvedAt: new Date(),
          approvedByUid: seed.parent1.uid,
        },
      });
    }

    it('a GOVERNED 13-year-old passes the floor (supervision is their protection)', async () => {
      // Window-valid grad-year email (round 2's domain gate applies to
      // everyone; the governed-age-gate suite uses the same idiom). Its
      // cohort says 15 while the DOB says 13 — a mismatch the governed
      // bypass deliberately skips along with the floor.
      const email = `gate.kid${GRAD_15}@ejm.org`;
      await seedGovernedKid('governed-kid-13', email, 13);
      await seedCode(email);
      const token = await getIdToken('governed-kid-13');

      const result = await callFunction<{ uid: string }>('doEnrollDoer', {
        ejemEmail: email,
        verificationCode: CODE,
        consentVersion: '1.0',
        enrollment: { contactEmail: 'kid@test.com' }, // identity + DOB on file
      }, token);
      expect(result.uid).toBe('governed-kid-13');

      const user = (await getDb().collection('users').doc('governed-kid-13').get()).data()!;
      expect(user.profiles.doer.enrollmentComplete).toBe(true);
    });

    it('parents CANNOT end supervision of the enrolled under-15 doer (the platform floor on revokeSupervision holds)', async () => {
      const parent1Token = await getIdToken(seed.parent1.uid);
      await expect(
        callFunction('revokeSupervision', { childUid: 'governed-kid-13' }, parent1Token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'guardian/child-under-15' },
      });
      const user = (await getDb().collection('users').doc('governed-kid-13').get()).data()!;
      expect(user.governedBy).toBeTruthy();
      expect(user.profiles.doer.enrollmentComplete).toBe(true);
    });

    it('admin force-revocation: profiles.doer SURVIVES (the §11.1 durability fact — enrollment gates never re-run), and the platform fences it by BLOCKING the minor', async () => {
      // The one revocation path that reaches an under-15: forceRevokeSupervision.
      // The profile is durable — which is exactly why doSubmitOffer must
      // re-check the floor at PR6 — but the account lands `blocked`, which
      // the §7.2 board rule (status == 'active') already excludes.
      await callFunction(
        'forceRevokeSupervision',
        { childUid: 'governed-kid-13', reason: 'integration test' },
        adminToken,
      );

      const user = (await getDb().collection('users').doc('governed-kid-13').get()).data()!;
      expect(user.governedBy).toBeUndefined();
      expect(user.profiles.doer.enrollmentComplete).toBe(true);
      expect(user.status).toBe('blocked');
    });

    it('a FRESH under-15 enrollee in the revoked-link shape (mirror gone, account active) is ungoverned again: refused under_15', async () => {
      // The revoked-link data shape the guardian suites seed directly
      // (governed-age-gate idiom): identityLocked persists, governedBy
      // mirror gone, link status 'revoked'. No live callable produces this
      // with an ACTIVE under-15 account today, but the mirror is the only
      // thing doEnrollDoer may trust — the enrollment floor must hold the
      // moment it is absent, however it got that way.
      const email = `revoked.kid${GRAD_15}@ejm.org`; // window-valid — past the domain gate, into the floor
      const uid = 'revoked-kid-14';
      await getAdminAuth().createUser({ uid, email });
      await getDb().collection('users').doc(uid).set({
        uid,
        email,
        status: 'active',
        firstName: 'Gate',
        lastName: 'Kid',
        dateOfBirth: new Date(dobWithAge(14)),
        language: 'en',
        identityLocked: true,
        // NO governedBy mirror — the post-revocation shape.
        profiles: {},
        notifPrefs: {},
        fcmTokens: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await getDb().collection('guardianLinks').doc(uid).set({
        childUid: uid,
        familyId: 'family-dupont',
        createdByParentUid: seed.parent1.uid,
        status: 'revoked',
        origin: 'parent_created',
        requestedAt: new Date(),
        revokedAt: new Date(),
      });

      await seedCode(email);
      const token = await getIdToken(uid);
      await expect(
        callFunction('doEnrollDoer', {
          ejemEmail: email,
          verificationCode: CODE,
          consentVersion: '1.0',
          enrollment: { contactEmail: 'kid@test.com' },
        }, token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { reason: 'under_15' },
      });
      const user = (await getDb().collection('users').doc(uid).get()).data()!;
      expect(user.profiles.doer).toBeUndefined();
    });
  });
});
