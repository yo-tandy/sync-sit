import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';

const CODE = '123456';
const TUTOR_UID = 'standalone-tutor-2';
const TUTOR_EMAIL = 'tutoronly2@test.com';
const SITTER_UID = 'standalone-sitter-2';
const SITTER_EMAIL = 'sitteronly2@test.com';

// Deliberately UNSTAMPED (issue #322): enrollFamily requires only the
// 'mailbox' class, and a doc with no identityClass — a pre-#322 doc — reads
// as exactly that. So this fixture doubles as the transitional-compatibility
// coverage for the parent path; the dedicated pins live in
// tests/integration/auth/verification-code-class.test.ts.
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

    await getAdminAuth().createUser({ uid: SITTER_UID, email: SITTER_EMAIL });
    await db.collection('users').doc(SITTER_UID).set({
      uid: SITTER_UID,
      email: SITTER_EMAIL,
      firstName: 'Sam',
      lastName: 'Sitter',
      status: 'active',
      language: 'en',
      profiles: {
        babysitter: { enrollmentComplete: true, ejemEmail: SITTER_EMAIL, searchable: true },
      },
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('rejects a tutor creating a family (role-exclusive, issue #116); no orphan family doc', async () => {
    const db = getDb();
    const countBefore = (await db.collection('families').get()).size;

    const token = await getIdToken(TUTOR_UID);
    await expect(
      callFunction('enrollFamily', familyPayload(), token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'role-exclusive', profile: 'parent' },
    });

    // The preflight runs before the family doc is created — a rejected tutor
    // must leave no orphan family behind.
    const countAfter = (await db.collection('families').get()).size;
    expect(countAfter).toBe(countBefore);

    // The user doc gained no parent profile; the tutor profile is untouched.
    const after = (await db.collection('users').doc(TUTOR_UID).get()).data()!;
    expect(after.profiles.parent).toBeUndefined();
    expect(after.profiles.tutor.searchable).toBe(true);
  });

  it('rejects a babysitter creating a family (role-exclusive, issue #116); no orphan family doc', async () => {
    const db = getDb();
    const countBefore = (await db.collection('families').get()).size;

    const token = await getIdToken(SITTER_UID);
    await expect(
      callFunction('enrollFamily', familyPayload(), token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'role-exclusive', profile: 'parent' },
    });

    const countAfter = (await db.collection('families').get()).size;
    expect(countAfter).toBe(countBefore);

    const after = (await db.collection('users').doc(SITTER_UID).get()).data()!;
    expect(after.profiles.parent).toBeUndefined();
    expect(after.profiles.babysitter.searchable).toBe(true);
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

  it('add-profile success records the presented consentVersion in the audit trail (issue #178)', async () => {
    // A signed-in user with no profiles yet — the one caller the wizard's
    // add-profile path serves (the consent-only step 2 is their only consent
    // surface, and addProfileToUser deliberately leaves the root consent
    // fields alone, so the audit entry is the only record).
    const db = getDb();
    const uid = 'bare-user-adds-family';
    await getAdminAuth().createUser({ uid, email: 'bareparent@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'bareparent@test.com',
      status: 'active',
      profiles: {},
      consentVersion: '1.0',
    });

    const token = await getIdToken(uid);
    const result = await callFunction<{ success: boolean; familyId: string }>(
      'enrollFamily',
      familyPayload({ consentVersion: '2025-12-01' }),
      token,
    );
    expect(result.success).toBe(true);

    // Root consent fields untouched (they belong to the original enrollment).
    const after = (await db.collection('users').doc(uid).get()).data()!;
    expect(after.profiles.parent.familyId).toBe(result.familyId);
    expect(after.consentVersion).toBe('1.0');

    // The new app's acceptance lives in the audit entry.
    const audit = await db
      .collection('auditLogs')
      .where('adminUserId', '==', uid)
      .where('action', '==', 'family_profile_added')
      .get();
    expect(
      audit.docs.some(
        (d) =>
          d.data().details?.consentVersion === '2025-12-01' &&
          d.data().details?.familyId === result.familyId,
      ),
    ).toBe(true);
  });

  it('unauthenticated with an existing auth email is rejected already-exists (race backstop)', async () => {
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
      // Race-backstop throw: no machine-readable reason since the silent
      // existing-account flow (issue #148) removed the client branch.
      code: 'ALREADY_EXISTS',
    });
  });
});
