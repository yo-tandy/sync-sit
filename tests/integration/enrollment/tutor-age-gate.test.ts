import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Age-gate integration tests for enrollTutor (governance PR 1).
//
// The gate runs against the REAL clock, so fixtures are computed relative to
// today: graduation years are derived from the September school-year boundary
// (mirroring shared-core's schoolYearEnd) and DOBs are anchored ~5 months past
// the birthday so the intended age holds on any test date.

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
  let m = d.getMonth() - 5; // 5 months before today → birthday safely passed
  if (m < 0) {
    m += 12;
    y -= 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y - age}-${pad(m + 1)}-15`;
}

function tutorEnrollment(dateOfBirth: string, overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Gate',
    lastName: 'Case',
    dateOfBirth,
    classLevel: 'Seconde',
    subjects: [{ subject: 'math', levels: ['CP'], rate: 20 }],
    sessionLengthsMin: [60],
    locationPrefs: ['online'],
    paddingMin: 15,
    contactEmail: 'gate@test.com',
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

function enroll(ejemEmail: string, dateOfBirth: string, token?: string) {
  return callFunction<{ uid: string }>(
    'enrollTutor',
    {
      ejemEmail,
      verificationCode: CODE,
      ...(token ? {} : { password: 'Str0ngPass1' }),
      consentVersion: '1.0',
      enrollment: tutorEnrollment(dateOfBirth),
    },
    token,
  );
}

describe('enrollTutor age gate', () => {
  let seed: SeedData;
  let adminToken: string;

  // Grad year for a cohort expected to be 15 (youngest valid EJM email) and 16.
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

  it('(a) rejects a 14-year-old with a consistent email: age/under-15', async () => {
    const email = `young.a${GRAD_15}@ejm.org`;
    await seedCode(email);
    // DOB says 14, email cohort expects 15 → within tolerance, but the floor fires.
    await expect(enroll(email, dobWithAge(14))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
  });

  it('(b) rejects a DOB/grad-year mismatch: age/mismatch', async () => {
    const email = `adult.b${GRAD_15}@ejm.org`;
    await seedCode(email);
    // DOB says 21, email cohort expects 15 → 6 classes apart.
    await expect(enroll(email, dobWithAge(21))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/mismatch' },
    });
  });

  it('(c) the same mismatch enrolls once an admin sets an exemption', async () => {
    const email = `exempt.c${GRAD_15}@ejm.org`;
    await callFunction('setEnrollmentExemption', { email, note: 'verified by admin' }, adminToken);
    await seedCode(email);
    const result = await enroll(email, dobWithAge(21));
    expect(result.uid).toBeTruthy();
    const user = (await getDb().collection('users').doc(result.uid).get()).data()!;
    expect(user.profiles.tutor.ejemEmail).toBe(email);
  });

  it('(d) an exemption NEVER waives the under-15 floor', async () => {
    const email = `floor.d${GRAD_15}@ejm.org`;
    await callFunction('setEnrollmentExemption', { email, note: 'should not matter' }, adminToken);
    await seedCode(email);
    await expect(enroll(email, dobWithAge(14))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
  });

  it('(e) a consistent 16-year-old still enrolls (regression guard)', async () => {
    const email = `fine.e${GRAD_16}@ejm.org`;
    await seedCode(email);
    const result = await enroll(email, dobWithAge(16));
    expect(result.uid).toBeTruthy();
  });

  it('(f) the authenticated add-profile path is gated too', async () => {
    const email = `addprof.f${GRAD_15}@ejm.org`;
    await seedCode(email);
    const token = await getIdToken(seed.parent1.uid);
    await expect(enroll(email, dobWithAge(14), token)).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
    // No tutor profile was added to the caller.
    const user = (await getDb().collection('users').doc(seed.parent1.uid).get()).data()!;
    expect(user.profiles.tutor).toBeUndefined();
  });
});
