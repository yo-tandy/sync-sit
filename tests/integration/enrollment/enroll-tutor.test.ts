import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getAdminAuth } from '../../setup/emulator.js';

// Baseline unauthenticated happy path — a brand-new tutor account.
// The cross-app suite covers the authenticated add-profile mode; this file
// guards the create path (auth user + full tutor doc + schedule + code cleanup).
const EMAIL = 'newtutor@ejm-test.org';
const CODE = '123456';

describe('enrollTutor (unauthenticated create path)', () => {
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

  it('creates auth user, full tutor doc, empty schedule, and consumes the code', async () => {
    const result = await callFunction<{ uid: string }>('enrollTutor', {
      ejemEmail: EMAIL,
      verificationCode: CODE,
      password: 'Str0ngPass1',
      consentVersion: '1.0',
      enrollment: {
        firstName: 'Nora',
        lastName: 'Newtutor',
        dateOfBirth: '2007-03-15',
        classLevel: 'CP',
        subjects: [{ subject: 'math', levels: ['CP'], rate: 20 }],
        sessionLengthsMin: [60],
        locationPrefs: ['online'],
        paddingMin: 15,
        contactEmail: 'contact@test.com',
        areaMode: 'arrondissement',
        arrondissements: ['75001'],
      },
    });
    expect(result.uid).toBeTruthy();

    const authUser = await getAdminAuth().getUserByEmail(EMAIL);
    expect(authUser.uid).toBe(result.uid);

    const db = getDb();
    const user = (await db.collection('users').doc(result.uid).get()).data()!;
    expect(user.email).toBe(EMAIL);
    expect(user.status).toBe('active');
    expect(user.firstName).toBe('Nora');
    expect(user.lastName).toBe('Newtutor');
    expect(user.consentVersion).toBe('1.0');

    const tutor = user.profiles.tutor;
    expect(tutor.enrollmentComplete).toBe(false);
    expect(tutor.ejemEmail).toBe(EMAIL);
    expect(tutor.searchable).toBe(false);
    expect(tutor.verification).toEqual({ identityStatus: 'not_submitted' });
    expect(tutor.classLevel).toBe('CP');
    expect(tutor.subjects).toEqual([{ subject: 'math', levels: ['CP'], rate: 20 }]);
    expect(tutor.sessionLengthsMin).toEqual([60]);
    expect(tutor.locationPrefs).toEqual(['online']);
    expect(tutor.contactEmail).toBe('contact@test.com');

    const sched = (await db.collection('schedules').doc(result.uid).get()).data()!;
    expect(sched.userId).toBe(result.uid);
    expect(sched.overrides).toEqual({});
    expect(sched.weekly.mon).toHaveLength(96);

    const codeDoc = await db.collection('verificationCodes').doc(EMAIL).get();
    expect(codeDoc.exists).toBe(false);
  });
});
