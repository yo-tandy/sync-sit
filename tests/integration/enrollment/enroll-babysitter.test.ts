import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getAdminAuth } from '../../setup/emulator.js';

// Baseline unauthenticated happy path — a brand-new babysitter account.
// The cross-app suite covers the authenticated add-profile mode; this file
// guards the create path (auth user + user doc + schedule + code cleanup).
const EMAIL = 'newsitter@ejm-test.org';
const CODE = '123456';

describe('enrollBabysitter (unauthenticated create path)', () => {
  beforeAll(async () => {
    await clearAll();
    await getDb().collection('verificationCodes').doc(EMAIL).set({
      code: CODE,
      email: EMAIL,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('creates auth user, minimal user doc, empty schedule, and consumes the code', async () => {
    const result = await callFunction<{ success: boolean; uid: string }>('enrollBabysitter', {
      ejemEmail: EMAIL,
      verificationCode: CODE,
      password: 'Str0ngPass1',
      consentVersion: '1.0',
    });
    expect(result.success).toBe(true);
    expect(result.uid).toBeTruthy();

    const authUser = await getAdminAuth().getUserByEmail(EMAIL);
    expect(authUser.uid).toBe(result.uid);

    const db = getDb();
    const user = (await db.collection('users').doc(result.uid).get()).data()!;
    expect(user.email).toBe(EMAIL);
    expect(user.status).toBe('active');
    expect(user.language).toBe('en');
    expect(user.consentVersion).toBe('1.0');
    // Canonical ROOT copy (issue #203 shared identity) written alongside the
    // nested back-compat duplicate below.
    expect(user.ejemEmail).toBe(EMAIL);
    expect(user.profiles.babysitter).toEqual({
      enrollmentComplete: false,
      ejemEmail: EMAIL,
      searchable: false,
    });

    const sched = (await db.collection('schedules').doc(result.uid).get()).data()!;
    expect(sched.userId).toBe(result.uid);
    expect(sched.holidayMode).toBe('same');
    expect(sched.overrides).toEqual({});
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      expect(sched.weekly[day]).toHaveLength(96);
      expect(sched.weekly[day].every((s: boolean) => s === false)).toBe(true);
    }

    const codeDoc = await db.collection('verificationCodes').doc(EMAIL).get();
    expect(codeDoc.exists).toBe(false);
  });
});
