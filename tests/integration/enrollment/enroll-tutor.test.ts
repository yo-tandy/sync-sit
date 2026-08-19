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
    // Canonical ROOT copies (issue #203 shared identity) written alongside
    // the nested back-compat duplicates on profiles.tutor.
    expect(user.ejemEmail).toBe(EMAIL);
    expect(user.contactEmail).toBe('contact@test.com');
    // Channels the user never supplied are ABSENT at the root, not null:
    // root presence means "set or cleared by the user", so an
    // enrollment-written null would read as a deliberate clear and block
    // both the nested fallback and the backfill (PR #206 review). The
    // nested duplicates keep their null convention.
    expect(user.contactPhone).toBeUndefined();
    expect(user.whatsapp).toBeUndefined();
    expect(user.profiles.tutor.contactPhone).toBeNull();

    const tutor = user.profiles.tutor;
    // Owner decision 2026-08-17: tutors share the babysitter trust model —
    // enrollment is complete at creation, no identity-verification state.
    expect(tutor.enrollmentComplete).toBe(true);
    expect(tutor.ejemEmail).toBe(EMAIL);
    expect(tutor.searchable).toBe(false);
    expect(tutor.verification).toBeUndefined();
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

describe('enrollTutor area coordinates (distance mode)', () => {
  const DIST_EMAIL = 'disttutor@ejm-test.org';
  const BOUNDS_EMAIL = 'boundstutor@ejm-test.org';

  beforeAll(async () => {
    await clearAll();
    const db = getDb();
    for (const email of [DIST_EMAIL, BOUNDS_EMAIL]) {
      await db.collection('verificationCodes').doc(email).set({
        code: CODE,
        email,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
        createdAt: new Date(),
      });
    }
  });

  afterAll(async () => {
    await clearAll();
  });

  function distanceEnrollment(overrides: Record<string, unknown> = {}) {
    return {
      firstName: 'Dana',
      lastName: 'Distance',
      dateOfBirth: '2006-05-20',
      classLevel: 'L1',
      subjects: [{ subject: 'math', levels: ['6e'], rate: 30 }],
      sessionLengthsMin: [60],
      locationPrefs: ['family_home'],
      paddingMin: 15,
      contactEmail: 'dana@test.com',
      areaMode: 'distance',
      areaAddress: '16 rue de Passy, 75016 Paris',
      areaLatLng: { lat: 48.8571, lng: 2.2795 },
      areaRadiusKm: 5,
      ...overrides,
    };
  }

  it('persists areaLatLng from the address pick onto the tutor profile', async () => {
    const result = await callFunction<{ uid: string }>('enrollTutor', {
      ejemEmail: DIST_EMAIL,
      verificationCode: CODE,
      password: 'Str0ngPass1',
      consentVersion: '1.0',
      enrollment: distanceEnrollment(),
    });

    const tutor = (await getDb().collection('users').doc(result.uid).get()).data()!.profiles.tutor;
    expect(tutor.areaMode).toBe('distance');
    expect(tutor.areaAddress).toBe('16 rue de Passy, 75016 Paris');
    expect(tutor.areaLatLng).toEqual({ lat: 48.8571, lng: 2.2795 });
    expect(tutor.areaRadiusKm).toBe(5);
  });

  it('rejects an out-of-bounds areaLatLng with invalid-argument', async () => {
    await expect(
      callFunction('enrollTutor', {
        ejemEmail: BOUNDS_EMAIL,
        verificationCode: CODE,
        password: 'Str0ngPass1',
        consentVersion: '1.0',
        enrollment: distanceEnrollment({ areaLatLng: { lat: 999, lng: 2.2795 } }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
