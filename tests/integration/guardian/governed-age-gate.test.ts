import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Governed accounts ↔ PR 1 age gates. A guardianLinks-ACTIVE account (its
// governedBy mirror present) carries a parent-attested DOB, so the
// self-enrollment gate and the search backstop stand down — supervision, not
// gating, is the protection. UNGOVERNED under-15s must stay blocked exactly
// as PR 1 pinned.

const CODE = '123456';

function schoolYearEnd(): number {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}
function gradYearForExpectedAge(expectedAge: number): number {
  return (schoolYearEnd() + (18 - expectedAge)) % 100;
}
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

const GRAD_15 = gradYearForExpectedAge(15);

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

function tutorEnrollment(dateOfBirth: string) {
  return {
    firstName: 'Gate',
    lastName: 'Kid',
    dateOfBirth,
    classLevel: 'Seconde',
    subjects: [{ subject: 'math', levels: ['CP'], rate: 20 }],
    sessionLengthsMin: [60],
    locationPrefs: ['online'],
    paddingMin: 15,
    contactEmail: 'gatekid@test.com',
    areaMode: 'arrondissement',
    arrondissements: ['75001'],
  };
}

describe('governed accounts and the age gates', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  /** A kid user doc as redeemKidInvite would have created it (13-year-old). */
  async function seedGovernedKid(
    uid: string,
    email: string,
    opts: { governed?: boolean; locked?: boolean } = { governed: true, locked: true },
  ) {
    const docData: Record<string, unknown> = {
      uid,
      email: email.toLowerCase(),
      status: 'active',
      firstName: 'Gate',
      lastName: 'Kid',
      dateOfBirth: new Date(dobWithAge(13)),
      language: 'en',
      profiles: {},
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (opts.locked) docData.identityLocked = true;
    if (opts.governed) {
      docData.governedBy = { familyId: seed.family1Id, linkedAt: new Date() };
      await getDb().collection('guardianLinks').doc(uid).set({
        childUid: uid,
        familyId: seed.family1Id,
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
    } else if (opts.locked) {
      // Revoked-link shape: lock persists, mirror gone.
      await getDb().collection('guardianLinks').doc(uid).set({
        childUid: uid,
        familyId: seed.family1Id,
        createdByParentUid: seed.parent1.uid,
        status: 'revoked',
        origin: 'parent_created',
        requestedAt: new Date(),
        confirmedAt: new Date(),
        revokedAt: new Date(),
        revokedByUid: seed.parent1.uid,
        consent: {
          tosVersion: '1.0',
          privacyVersion: '1.0',
          supervisionAgreementVersion: '1.0',
          approvedAt: new Date(),
          approvedByUid: seed.parent1.uid,
        },
      });
    }
    await getDb().collection('users').doc(uid).set(docData);
  }

  // ── enrollTutor add-profile path ──

  it('a governed 13-year-old CAN add a tutor profile (gate bypassed)', async () => {
    const email = `gov.kid.a${GRAD_15}@ejm.org`;
    await seedGovernedKid('govKidA', email);
    await seedCode(email);
    const token = await getIdToken('govKidA');

    const result = await callFunction<{ uid: string }>(
      'enrollTutor',
      {
        ejemEmail: email,
        verificationCode: CODE,
        consentVersion: '1.0',
        enrollment: tutorEnrollment(dobWithAge(13)),
      },
      token,
    );
    expect(result.uid).toBe('govKidA');
    const user = (await getDb().collection('users').doc('govKidA').get()).data()!;
    expect(user.profiles.tutor).toBeTruthy();
    expect(user.profiles.tutor.ejemEmail).toBe(email);
  });

  it('an UNGOVERNED 13-year-old is still blocked (PR 1 regression pin)', async () => {
    const email = `ungov.kid.b${GRAD_15}@ejm.org`;
    await seedGovernedKid('ungovKidB', email, { governed: false, locked: false });
    await seedCode(email);
    const token = await getIdToken('ungovKidB');

    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: email,
          verificationCode: CODE,
          consentVersion: '1.0',
          enrollment: tutorEnrollment(dobWithAge(13)),
        },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
    const user = (await getDb().collection('users').doc('ungovKidB').get()).data()!;
    expect(user.profiles.tutor).toBeUndefined();
  });

  it('a REVOKED link (governedBy gone) restores the block', async () => {
    const email = `revoked.kid.c${GRAD_15}@ejm.org`;
    await seedGovernedKid('revKidC', email, { governed: false, locked: true });
    await seedCode(email);
    const token = await getIdToken('revKidC');

    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: email,
          verificationCode: CODE,
          consentVersion: '1.0',
          enrollment: tutorEnrollment(dobWithAge(13)),
        },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
  });

  it('the UNAUTHENTICATED new-account path keeps the full gate even for invited emails', async () => {
    const email = `newacct.kid.d${GRAD_15}@ejm.org`;
    await seedCode(email);
    await expect(
      callFunction('enrollTutor', {
        ejemEmail: email,
        verificationCode: CODE,
        password: 'Str0ngPass1',
        consentVersion: '1.0',
        enrollment: tutorEnrollment(dobWithAge(13)),
      }),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
  });

  // ── searchBabysitters backstop ──

  async function seedYoungBabysitter(uid: string, email: string, governed: boolean) {
    const docData: Record<string, unknown> = {
      uid,
      email: email.toLowerCase(),
      status: 'active',
      firstName: governed ? 'GovernedSitter' : 'UngovernedSitter',
      lastName: 'Young',
      dateOfBirth: new Date(dobWithAge(13)),
      language: 'en',
      profiles: {
        babysitter: {
          enrollmentComplete: true,
          ejemEmail: email.toLowerCase(),
          searchable: true,
          classLevel: '2nde',
          languages: ['French'],
          kidAgeRange: { min: 1, max: 14 },
          maxKids: 3,
          hourlyRate: 10,
          contactEmail: email.toLowerCase(),
          areaMode: 'arrondissement',
          arrondissements: ['16e'],
          areaLatLng: { lat: 48.8566, lng: 2.2769 },
        },
      },
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (governed) {
      docData.governedBy = { familyId: seed.family1Id, linkedAt: new Date() };
    }
    await getDb().collection('users').doc(uid).set(docData);
  }

  it('search backstop: governed under-15 VISIBLE, ungoverned under-15 hidden', async () => {
    await seedYoungBabysitter('govSitter', `gov.sitter${GRAD_15}@ejm.org`, true);
    await seedYoungBabysitter('ungovSitter', `ungov.sitter${GRAD_15}@ejm.org`, false);
    const parentToken = await getIdToken(seed.parent1.uid);

    const result = await callFunction<{ results: Array<{ uid: string }> }>(
      'searchBabysitters',
      {
        type: 'one_time',
        kidAges: [6],
        numberOfKids: 1,
        latLng: { lat: 48.8566, lng: 2.2769 },
        filters: {},
      },
      parentToken,
    );

    const uids = result.results.map((r) => r.uid);
    expect(uids).toContain('govSitter');
    expect(uids).not.toContain('ungovSitter');
  });
});
