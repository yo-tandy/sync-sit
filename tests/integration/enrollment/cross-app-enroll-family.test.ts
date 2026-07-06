import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';

const CODE = '123456';
const TUTOR_UID = 'standalone-tutor-2';
const TUTOR_EMAIL = 'tutoronly2@test.com';

async function seedCode(email: string) {
  await getDb().collection('verificationCodes').doc(email.toLowerCase()).set({
    code: CODE,
    email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    createdAt: new Date(),
  });
}

function familyPayload(overrides: Record<string, unknown> = {}) {
  return {
    familyName: 'CrossApp',
    firstName: 'Ignored',
    address: '10 Rue de Rivoli, 75001 Paris',
    latLng: { lat: 48.8606, lng: 2.3376 },
    kids: [{ firstName: 'Kid', age: 7, languages: ['French'] }],
    ...overrides,
  };
}

describe('enrollFamily cross-app add-profile', () => {
  beforeAll(async () => {
    await clearAll();
    const db = getDb();
    // getIdToken exchanges a custom token; ensure an Auth-emulator user exists.
    await getAdminAuth().createUser({ uid: TUTOR_UID, email: TUTOR_EMAIL });
    await db.collection('users').doc(TUTOR_UID).set({
      uid: TUTOR_UID,
      email: TUTOR_EMAIL,
      firstName: 'Tia',
      lastName: 'Tutor',
      status: 'active',
      language: 'fr',
      profiles: {
        tutor: { enrollmentComplete: true, ejemEmail: TUTOR_EMAIL, searchable: true },
      },
      consentVersion: '1.0',
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('adds profiles.parent + family to an authed tutor; tutor profile and base fields intact', async () => {
    const token = await getIdToken(TUTOR_UID);
    const result = await callFunction<{ success: boolean; uid: string; familyId: string }>(
      'enrollFamily',
      familyPayload(),
      token,
    );
    expect(result.success).toBe(true);
    expect(result.uid).toBe(TUTOR_UID);
    expect(result.familyId).toBeTruthy();

    const db = getDb();
    const familyDoc = await db.collection('families').doc(result.familyId).get();
    expect(familyDoc.exists).toBe(true);
    expect(familyDoc.data()!.familyName).toBe('CrossApp');
    expect(familyDoc.data()!.parentIds).toEqual([TUTOR_UID]);

    const kids = await db.collection('families').doc(result.familyId).collection('kids').get();
    expect(kids.size).toBe(1);

    const after = (await db.collection('users').doc(TUTOR_UID).get()).data()!;
    expect(after.profiles.parent).toEqual({ enrollmentComplete: true, familyId: result.familyId });
    expect(after.profiles.tutor.searchable).toBe(true);
    expect(after.firstName).toBe('Tia'); // existing wins over 'Ignored'
  });

  it('profile-exists leaves no orphan family (preflight runs before family creation)', async () => {
    const db = getDb();
    const uid = 'already-parent-1';
    await getAdminAuth().createUser({ uid, email: 'alreadyparent@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'alreadyparent@test.com',
      status: 'active',
      profiles: { parent: { enrollmentComplete: true, familyId: 'f-existing' } },
    });

    const countBefore = (await db.collection('families').get()).size;

    const token = await getIdToken(uid);
    await expect(
      callFunction('enrollFamily', familyPayload(), token),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists', profile: 'parent' },
    });

    const countAfter = (await db.collection('families').get()).size;
    expect(countAfter).toBe(countBefore);
  });

  it('unauthenticated with an existing auth email gets account-exists details', async () => {
    await seedCode(TUTOR_EMAIL);
    await expect(
      callFunction('enrollFamily', {
        email: TUTOR_EMAIL,
        verificationCode: CODE,
        password: 'Str0ngPass1',
        familyName: 'CrossApp',
        firstName: 'Ignored',
        address: '10 Rue de Rivoli, 75001 Paris',
        latLng: { lat: 48.8606, lng: 2.3376 },
        kids: [],
      }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });
});
