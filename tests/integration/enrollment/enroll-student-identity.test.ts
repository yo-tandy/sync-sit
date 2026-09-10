import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getDb, getAdminAuth } from '../../setup/emulator.js';

// Integration tests for enrollStudentIdentity (issue #435 milestone, PR4):
// the unified flow's root-only account-creation callable, called BEFORE the
// user has picked sit or study. Mirrors the age-gate fixture conventions in
// tutor-age-gate.test.ts (real clock, cohort math relative to today).

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

const GRAD_16 = gradYearForExpectedAge(16);
const GRAD_15 = gradYearForExpectedAge(15);

async function seedCode(email: string, overrides: Record<string, unknown> = {}) {
  await getDb().collection('verificationCodes').doc(email.toLowerCase()).set({
    code: CODE,
    identityClass: 'ejm',
    email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  });
}

function payload(email: string, overrides: Record<string, unknown> = {}) {
  return {
    ejemEmail: email,
    verificationCode: CODE,
    password: 'Str0ngPass1',
    consentVersion: '1.0',
    firstName: 'Iris',
    lastName: 'Martin',
    dateOfBirth: dobWithAge(16),
    classLevel: 'Terminale',
    gender: 'female',
    contactEmail: 'iris.contact@test.com',
    contactPhone: '+33600000010',
    whatsapp: null,
    bio: 'Hi there!',
    address: null,
    contactVisibilityConsent: true,
    language: 'en',
    ...overrides,
  };
}

describe('enrollStudentIdentity', () => {
  beforeAll(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
  });

  it('creates the Auth user + a root-only users/{uid} doc (no role profile)', async () => {
    const email = `iris.student${GRAD_16}@ejm-test.org`;
    await seedCode(email);
    const result = await callFunction<{ success: boolean; uid: string }>(
      'enrollStudentIdentity',
      payload(email),
    );
    expect(result.success).toBe(true);
    expect(result.uid).toBeTruthy();

    const authUser = await getAdminAuth().getUser(result.uid);
    expect(authUser.email).toBe(email.toLowerCase());

    const doc = (await getDb().collection('users').doc(result.uid).get()).data()!;
    expect(doc.profiles).toEqual({});
    expect(doc.status).toBe('active');
    expect(doc.firstName).toBe('Iris');
    expect(doc.lastName).toBe('Martin');
    expect(doc.classLevel).toBe('Terminale');
    expect(doc.gender).toBe('female');
    expect(doc.ejemEmail).toBe(email.toLowerCase());
    expect(doc.contactEmail).toBe('iris.contact@test.com');
    expect(doc.contactPhone).toBe('+33600000010');
    // whatsapp: never supplied by this payload — omitted, not null
    // (root-presence convention, same as enrollBabysitter/enrollTutor's
    // new-account write). address: the payload explicitly sends `null`
    // (StepAdditionalInfo always sends SOME value, never omits the key —
    // unlike the contact trio) so it round-trips as an explicit null, not
    // an omission.
    expect(doc.whatsapp).toBeUndefined();
    expect(doc.address).toBeNull();
    expect(doc.bio).toBe('Hi there!');
    expect(doc.contactVisibilityConsent).toBe(true);
    expect(doc.consentVersion).toBe('1.0');

    // The verification code is consumed — cannot be replayed.
    const codeDoc = await getDb().collection('verificationCodes').doc(email.toLowerCase()).get();
    expect(codeDoc.exists).toBe(false);
  });

  it('records contactVisibilityConsent: false when the consent checkbox was left unchecked', async () => {
    const email = `noconsent.student${GRAD_16}@ejm-test.org`;
    await seedCode(email);
    const result = await callFunction<{ uid: string }>(
      'enrollStudentIdentity',
      payload(email, { contactVisibilityConsent: false }),
    );
    const doc = (await getDb().collection('users').doc(result.uid).get()).data()!;
    expect(doc.contactVisibilityConsent).toBe(false);
  });

  it('rejects an invalid verification code', async () => {
    const email = `badcode.student${GRAD_16}@ejm-test.org`;
    await seedCode(email);
    await expect(
      callFunction('enrollStudentIdentity', payload(email, { verificationCode: '000000' })),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects when no verification code was ever sent', async () => {
    const email = `nocode.student${GRAD_16}@ejm-test.org`;
    await expect(callFunction('enrollStudentIdentity', payload(email))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a non-EJM-class verification code (issue #322 gate)', async () => {
    const email = `weakclass.student${GRAD_16}@ejm-test.org`;
    // No identityClass stamp — the weakest class, must not satisfy the gate.
    await getDb().collection('verificationCodes').doc(email.toLowerCase()).set({
      code: CODE,
      email: email.toLowerCase(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      createdAt: new Date(),
    });
    await expect(callFunction('enrollStudentIdentity', payload(email))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
  });

  it('rejects an under-15 applicant even with a consistent-looking cohort email', async () => {
    // Real @ejm.org domain required here (unlike the other fixtures in this
    // file): the age gate only fires when validateEjmEmail's DOMAIN check
    // passes — an @ejm-test.org email (used elsewhere for the code-class
    // seeding trick) silently skips the whole age check, same as
    // enrollTutor's identical gate (mirrors tutor-age-gate.test.ts).
    const email = `young.student${GRAD_15}@ejm.org`;
    await seedCode(email);
    await expect(
      callFunction('enrollStudentIdentity', payload(email, { dateOfBirth: dobWithAge(14) })),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/under-15' },
    });
  });

  it('rejects a DOB/grad-year mismatch', async () => {
    const email = `mismatch.student${GRAD_15}@ejm.org`;
    await seedCode(email);
    await expect(
      callFunction('enrollStudentIdentity', payload(email, { dateOfBirth: dobWithAge(21) })),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'age/mismatch' },
    });
  });

  it('rejects when neither contact channel is provided', async () => {
    const email = `nocontact.student${GRAD_16}@ejm-test.org`;
    await seedCode(email);
    await expect(
      callFunction(
        'enrollStudentIdentity',
        payload(email, { contactEmail: '', contactPhone: '', whatsapp: null }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  describe('idempotency against a double submit', () => {
    const email = `double.student${GRAD_16}@ejm-test.org`;

    beforeEach(async () => {
      await seedCode(email);
    });

    it('a retried submit for an already-created account fails cleanly (no duplicate, no partial state)', async () => {
      const first = await callFunction<{ uid: string }>('enrollStudentIdentity', payload(email));
      expect(first.uid).toBeTruthy();

      // Re-seed a fresh code (the first call consumed the previous one) to
      // isolate the assertion to the ACCOUNT-EXISTS race, not a code reuse.
      await seedCode(email);
      await expect(callFunction('enrollStudentIdentity', payload(email))).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
      });

      // Exactly one Auth user for this email, and the doc is unchanged.
      const authUser = await getAdminAuth().getUserByEmail(email.toLowerCase());
      expect(authUser.uid).toBe(first.uid);
      const doc = (await getDb().collection('users').doc(first.uid).get()).data()!;
      expect(doc.profiles).toEqual({});
    });
  });
});
