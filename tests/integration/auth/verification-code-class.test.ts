import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getAdminAuth } from '../../setup/emulator.js';

// Issue #322 — verificationCodes/{email} is ONE namespace written by TWO
// callables: verifyEjmEmail (EJM-valid or admin-preapproved address) and the
// public any-domain verifyParentEmail. "A code exists for this address" was
// therefore never proof of an EJM identity, but enrollTutor and
// enrollBabysitter read it as if it were.
//
// Every code doc now records what it PROVES (identityClass, plus issuer as
// provenance) and every consumer asserts the class it requires. This suite
// pins: the writers' stamps, the attack (a parent-issued code must not
// satisfy an EJM-gated enrollment), the legitimate end-to-end flow for all
// three apps plus the parent flow, and the transitional case of a doc with
// no stamp at all.

const REASON = { reason: 'code_identity_class' };

/** Calendar year the current school year ends in (September boundary). */
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

const GRAD_17 = gradYearForExpectedAge(17);

/** Mint a REAL code through a real callable and read it back (the emulator
 *  has no mailbox — this is the wizard's "user reads the email" step). */
async function mintCode(callable: 'verifyEjmEmail' | 'verifyParentEmail', email: string) {
  await callFunction(callable, { email });
  const doc = await getDb().collection('verificationCodes').doc(email.toLowerCase()).get();
  if (!doc.exists) throw new Error(`${callable} wrote no code doc for ${email}`);
  return doc.data()!.code as string;
}

async function codeDoc(email: string) {
  return (await getDb().collection('verificationCodes').doc(email.toLowerCase()).get()).data()!;
}

/** A pre-#322 code doc: no issuer, no identityClass. */
async function seedUnstampedCode(email: string, code: string) {
  await getDb()
    .collection('verificationCodes')
    .doc(email.toLowerCase())
    .set({
      code,
      email: email.toLowerCase(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      createdAt: new Date(),
    });
}

function tutorPayload(ejemEmail: string, verificationCode: string, dateOfBirth: string) {
  return {
    ejemEmail,
    verificationCode,
    password: 'Str0ngPass1',
    consentVersion: '1.0',
    enrollment: {
      firstName: 'Class',
      lastName: 'Pin',
      dateOfBirth,
      classLevel: 'CP',
      subjects: [{ subject: 'math', levels: ['CP'], rate: 20 }],
      sessionLengthsMin: [60],
      locationPrefs: ['online'],
      paddingMin: 15,
      contactEmail: 'contact@test.com',
      areaMode: 'arrondissement',
      arrondissements: ['75001'],
    },
  };
}

function doerPayload(ejemEmail: string, verificationCode: string, dateOfBirth: string) {
  return {
    ejemEmail,
    verificationCode,
    password: 'Str0ngPass1',
    consentVersion: '1.0',
    enrollment: {
      firstName: 'Class',
      lastName: 'Pin',
      dateOfBirth,
      contactEmail: 'contact@test.com',
    },
  };
}

function familyPayload(email: string, verificationCode: string) {
  return {
    email,
    verificationCode,
    password: 'Str0ngPass1',
    familyName: 'ClassPin',
    firstName: 'Pat',
    address: '10 Rue de Rivoli, 75001 Paris',
    latLng: { lat: 48.8606, lng: 2.3376 },
    kids: [{ firstName: 'Kid', age: 5, languages: ['English'] }],
  };
}

describe('#322 — the code doc records what it proves', () => {
  beforeAll(async () => {
    await clearAll();
  });
  afterAll(async () => {
    await clearAll();
  });

  it("verifyEjmEmail stamps identityClass 'ejm' and its own issuer", async () => {
    const email = `stamp.ejm${GRAD_17}@ejm.org`;
    await mintCode('verifyEjmEmail', email);
    const data = await codeDoc(email);
    expect(data.identityClass).toBe('ejm');
    expect(data.issuer).toBe('verifyEjmEmail');
  });

  it("verifyParentEmail stamps identityClass 'mailbox' — it checks no domain and no membership", async () => {
    const email = 'stamp.parent@anywhere.example';
    await mintCode('verifyParentEmail', email);
    const data = await codeDoc(email);
    expect(data.identityClass).toBe('mailbox');
    expect(data.issuer).toBe('verifyParentEmail');
  });

  it('the account-exists DECOY carries the CALLING callable stamp (issue #148 symmetry survives)', async () => {
    // A decoy that graded differently from a fresh code would re-open the
    // enumeration oracle one step downstream, in the enroll callables.
    const email = 'decoy.owner@anywhere.example';
    const user = await getAdminAuth().createUser({ email, password: 'Str0ngPass1' });
    await getDb().collection('users').doc(user.uid).set({ email, status: 'active' });

    await callFunction('verifyParentEmail', { email });
    const decoy = await codeDoc(email);
    expect(decoy.decoy).toBe(true);
    expect(decoy.identityClass).toBe('mailbox');
    expect(decoy.issuer).toBe('verifyParentEmail');
  });
});

describe('#322 attack — a parent-issued code must NOT satisfy an EJM-gated enrollment', () => {
  beforeAll(async () => {
    await clearAll();
  });
  afterAll(async () => {
    await clearAll();
  });

  it('enrollTutor refuses a code minted through verifyParentEmail on a non-EJM address', async () => {
    // Before #322 this created a tutor profile for an outsider: enrollTutor
    // has no domain check of its own and read the shared namespace.
    const email = 'attacker.tutor@anywhere.example';
    const code = await mintCode('verifyParentEmail', email);
    await expect(
      callFunction('enrollTutor', tutorPayload(email, code, '2007-03-15')),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });

    // No account was created, and the refusal burned no brute-force attempt:
    // it is about what the DOC is, not about what the caller typed.
    await expect(getAdminAuth().getUserByEmail(email)).rejects.toThrow();
    expect((await codeDoc(email)).attempts).toBe(0);
  });

  it('enrollBabysitter refuses a code minted through verifyParentEmail on a non-EJM address', async () => {
    const email = 'attacker.sitter@anywhere.example';
    const code = await mintCode('verifyParentEmail', email);
    await expect(
      callFunction('enrollBabysitter', {
        ejemEmail: email,
        verificationCode: code,
        password: 'Str0ngPass1',
        consentVersion: '1.0',
      }),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });

    await expect(getAdminAuth().getUserByEmail(email)).rejects.toThrow();
    expect((await codeDoc(email)).attempts).toBe(0);
  });

  it('doEnrollDoer refuses a parent-issued code even on an EJM-VALID address (the stamp, not the domain check, does it)', async () => {
    // sync-do also re-checks the address locally (PR #320 round 2), which
    // this address deliberately passes — so what refuses here is the code's
    // own identity class. Both locks are live; this pins the new one.
    const email = `attacker.doer${GRAD_17}@ejm.org`;
    const code = await mintCode('verifyParentEmail', email);
    await expect(
      callFunction('doEnrollDoer', doerPayload(email, code, dobWithAge(17))),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });

    await expect(getAdminAuth().getUserByEmail(email)).rejects.toThrow();
    expect((await codeDoc(email)).attempts).toBe(0);
  });

  it("doEnrollDoer's local address check still stands on its own (defence in depth, not now-redundant)", async () => {
    const email = 'attacker.doer@anywhere.example';
    const code = await mintCode('verifyParentEmail', email);
    await expect(
      callFunction('doEnrollDoer', doerPayload(email, code, dobWithAge(17))),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_ejm_email' } });
  });

  it("verifyCode's EJM hint refuses a parent-issued code at the wizard's verify step", async () => {
    const email = 'attacker.step@anywhere.example';
    const code = await mintCode('verifyParentEmail', email);
    await expect(
      callFunction('verifyCode', { email, code, requireIdentityClass: 'ejm' }),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });
    // Unchanged for the parent wizards, which pass no hint: the default is
    // the weakest class, exactly what this callable accepted before #322.
    expect(await callFunction('verifyCode', { email, code })).toEqual({ valid: true });
  });
});

describe('#322 — legitimate flows still work end to end', () => {
  beforeAll(async () => {
    await clearAll();
  });
  afterAll(async () => {
    await clearAll();
  });

  it('sit: verifyEjmEmail -> enrollBabysitter', async () => {
    const email = `legit.sitter${GRAD_17}@ejm.org`;
    const code = await mintCode('verifyEjmEmail', email);
    const result = await callFunction<{ success: boolean; uid: string }>('enrollBabysitter', {
      ejemEmail: email,
      verificationCode: code,
      password: 'Str0ngPass1',
      consentVersion: '1.0',
    });
    expect(result.success).toBe(true);
    expect((await getDb().collection('users').doc(result.uid).get()).data()!.ejemEmail).toBe(email);
  });

  it('study: verifyEjmEmail -> enrollTutor', async () => {
    const email = `legit.tutor${GRAD_17}@ejm.org`;
    const code = await mintCode('verifyEjmEmail', email);
    const result = await callFunction<{ uid: string }>(
      'enrollTutor',
      tutorPayload(email, code, dobWithAge(17)),
    );
    expect(result.uid).toBeTruthy();
    expect((await getDb().collection('users').doc(result.uid).get()).data()!.ejemEmail).toBe(email);
  });

  it('do: verifyEjmEmail -> doEnrollDoer', async () => {
    const email = `legit.doer${GRAD_17}@ejm.org`;
    const code = await mintCode('verifyEjmEmail', email);
    const result = await callFunction<{ uid: string }>(
      'doEnrollDoer',
      doerPayload(email, code, dobWithAge(17)),
    );
    expect(result.uid).toBeTruthy();
    const user = (await getDb().collection('users').doc(result.uid).get()).data()!;
    expect(user.profiles.doer.enrollmentComplete).toBe(true);
  });

  it('parent: verifyParentEmail -> enrollFamily (the mailbox class is all this flow needs)', async () => {
    const email = 'legit.parent@anywhere.example';
    const code = await mintCode('verifyParentEmail', email);
    const result = await callFunction<{ success: boolean; familyId: string }>(
      'enrollFamily',
      familyPayload(email, code),
    );
    expect(result.success).toBe(true);
    expect(result.familyId).toBeTruthy();
  });

  it('an EJM-issued code also satisfies the parent flow (ejm implies mailbox)', async () => {
    const email = `legit.ejmparent${GRAD_17}@ejm.org`;
    const code = await mintCode('verifyEjmEmail', email);
    const result = await callFunction<{ success: boolean }>(
      'enrollFamily',
      familyPayload(email, code),
    );
    expect(result.success).toBe(true);
  });
});

describe('#322 transitional — a code doc written before the stamp existed', () => {
  const CODE = '123456';

  beforeAll(async () => {
    await clearAll();
  });
  afterAll(async () => {
    await clearAll();
  });

  it('reads as the WEAKEST class: enrollTutor refuses it (fails closed)', async () => {
    // A doc with no stamp says nothing about which callable wrote it, so it
    // cannot be allowed to complete an EJM-gated enrollment — otherwise the
    // pre-deploy window is a way to walk the very hole #322 closes. Codes
    // live 10 minutes, so the cost is an in-flight signup re-requesting one.
    const email = `legacy.tutor${GRAD_17}@ejm.org`;
    await seedUnstampedCode(email, CODE);
    await expect(
      callFunction('enrollTutor', tutorPayload(email, CODE, dobWithAge(17))),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });
  });

  it('enrollBabysitter refuses it too', async () => {
    const email = `legacy.sitter${GRAD_17}@ejm.org`;
    await seedUnstampedCode(email, CODE);
    await expect(
      callFunction('enrollBabysitter', {
        ejemEmail: email,
        verificationCode: CODE,
        password: 'Str0ngPass1',
        consentVersion: '1.0',
      }),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });
  });

  it('doEnrollDoer refuses it too', async () => {
    const email = `legacy.doer${GRAD_17}@ejm.org`;
    await seedUnstampedCode(email, CODE);
    await expect(
      callFunction('doEnrollDoer', doerPayload(email, CODE, dobWithAge(17))),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });
  });

  it('enrollFamily still ACCEPTS it — the parent flow requires only mailbox ownership', async () => {
    const email = 'legacy.parent@anywhere.example';
    await seedUnstampedCode(email, CODE);
    const result = await callFunction<{ success: boolean }>(
      'enrollFamily',
      familyPayload(email, CODE),
    );
    expect(result.success).toBe(true);
  });

  it('joinFamily still ACCEPTS it — the invite token is the authorization', async () => {
    const email = 'legacy.joiner@anywhere.example';
    const token = 'legacy-join-token';
    const db = getDb();
    await db.collection('families').doc('legacy-family').set({
      familyName: 'LegacyFam',
      parentIds: ['legacy-parent'],
      createdAt: new Date(),
    });
    await db.collection('inviteLinks').doc(token).set({
      token,
      familyId: 'legacy-family',
      familyName: 'LegacyFam',
      createdByUserId: 'legacy-parent',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      used: false,
      createdAt: new Date(),
    });
    await seedUnstampedCode(email, CODE);

    const result = await callFunction<{ success: boolean }>('joinFamily', {
      token,
      email,
      verificationCode: CODE,
      password: 'Str0ngPass1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(result.success).toBe(true);
  });

  it("verifyCode accepts it by default and refuses it under the 'ejm' hint", async () => {
    const email = 'legacy.step@anywhere.example';
    await seedUnstampedCode(email, CODE);
    expect(await callFunction('verifyCode', { email, code: CODE })).toEqual({ valid: true });
    await expect(
      callFunction('verifyCode', { email, code: CODE, requireIdentityClass: 'ejm' }),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: REASON });
  });
});
