import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';

const TUTOR_UID = 'standalone-tutor-3';
const TUTOR_EMAIL = 'tutoronly3@test.com';
const FAMILY_ID = 'fam-join-1';
const EXISTING_PARENT = 'some-other-parent';

async function seedInvite(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await getDb().collection('inviteLinks').doc(token).set({
    token,
    familyId: FAMILY_ID,
    familyName: 'JoinTest',
    createdByUserId: EXISTING_PARENT,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    used: false,
    createdAt: new Date(),
    ...overrides,
  });
}

describe('joinFamily cross-app add-profile', () => {
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

    await db.collection('families').doc(FAMILY_ID).set({
      familyId: FAMILY_ID,
      familyName: 'JoinTest',
      address: '10 Rue de Rivoli, 75001 Paris',
      latLng: { lat: 48.8606, lng: 2.3376 },
      parentIds: [EXISTING_PARENT],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('adds profiles.parent to an authed tutor via token only; tutor profile and base fields intact', async () => {
    const token = 'token-join-success';
    await seedInvite(token);

    const idToken = await getIdToken(TUTOR_UID);
    const result = await callFunction<{ success: boolean; uid: string; familyId: string }>(
      'joinFamily',
      { token },
      idToken,
    );
    expect(result.success).toBe(true);
    expect(result.uid).toBe(TUTOR_UID);
    expect(result.familyId).toBe(FAMILY_ID);

    const db = getDb();
    const after = (await db.collection('users').doc(TUTOR_UID).get()).data()!;
    expect(after.profiles.parent).toEqual({ enrollmentComplete: true, familyId: FAMILY_ID });
    expect(after.profiles.tutor.searchable).toBe(true);
    expect(after.firstName).toBe('Tia'); // existing wins

    const family = (await db.collection('families').doc(FAMILY_ID).get()).data()!;
    expect(family.parentIds).toContain(TUTOR_UID);
    expect(family.parentIds).toContain(EXISTING_PARENT);

    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(true);
    expect(invite.usedByUserId).toBe(TUTOR_UID);
  });

  it('rejects an already-used invite (authed)', async () => {
    const token = 'token-join-used';
    await seedInvite(token, { used: true });

    const idToken = await getIdToken(TUTOR_UID);
    await expect(
      callFunction('joinFamily', { token }, idToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an authed caller who already has a parent profile; invite left unused', async () => {
    const db = getDb();
    const uid = 'already-parent-2';
    await getAdminAuth().createUser({ uid, email: 'alreadyparent2@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'alreadyparent2@test.com',
      status: 'active',
      profiles: { parent: { enrollmentComplete: true, familyId: 'f-existing' } },
    });

    const token = 'token-join-already-parent';
    await seedInvite(token);

    const idToken = await getIdToken(uid);
    await expect(
      callFunction('joinFamily', { token }, idToken),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists', profile: 'parent' },
    });

    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(false);
  });
});
