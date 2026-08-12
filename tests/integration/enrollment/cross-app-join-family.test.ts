import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';

const TUTOR_UID = 'standalone-tutor-3';
const TUTOR_EMAIL = 'tutoronly3@test.com';
const SITTER_UID = 'standalone-sitter-3';
const SITTER_EMAIL = 'sitteronly3@test.com';
const PLAIN_UID = 'standalone-plain-3';
const PLAIN_EMAIL = 'plainonly3@test.com';
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
    // getIdToken exchanges a custom token; ensure Auth-emulator users exist.
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

    // Babysitters are providers too, so babysitter→parent is equally
    // role-exclusive — SITTER_UID pins the rejection.
    await getAdminAuth().createUser({ uid: SITTER_UID, email: SITTER_EMAIL });
    await db.collection('users').doc(SITTER_UID).set({
      uid: SITTER_UID,
      email: SITTER_EMAIL,
      firstName: 'Sam',
      lastName: 'Sitter',
      status: 'active',
      language: 'en',
      profiles: {
        babysitter: { enrollmentComplete: true, ejemEmail: SITTER_EMAIL, searchable: false },
      },
    });

    // A profile-less active account stays legal for joinFamily's add-profile
    // path, so aux tests can reject for exactly one reason (the used invite).
    await getAdminAuth().createUser({ uid: PLAIN_UID, email: PLAIN_EMAIL });
    await db.collection('users').doc(PLAIN_UID).set({
      uid: PLAIN_UID,
      email: PLAIN_EMAIL,
      firstName: 'Pat',
      lastName: 'Plain',
      status: 'active',
      language: 'en',
      profiles: {},
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

  it('rejects a tutor joining via invite (role-exclusive, issue #116); invite left unused', async () => {
    const token = 'token-join-tutor-rejected';
    await seedInvite(token);

    const idToken = await getIdToken(TUTOR_UID);
    await expect(
      callFunction('joinFamily', { token }, idToken),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'role-exclusive', profile: 'parent' },
    });

    const db = getDb();
    // The user doc gained no parent profile; the tutor profile is untouched.
    const after = (await db.collection('users').doc(TUTOR_UID).get()).data()!;
    expect(after.profiles.parent).toBeUndefined();
    expect(after.profiles.tutor.searchable).toBe(true);

    // Family membership untouched.
    const family = (await db.collection('families').doc(FAMILY_ID).get()).data()!;
    expect(family.parentIds).toEqual([EXISTING_PARENT]);

    // The invite is left unused — still redeemable by a legitimate parent.
    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(false);
    expect(invite.usedByUserId).toBeUndefined();
  });

  it('rejects a babysitter joining via invite (role-exclusive, issue #116); invite left unused', async () => {
    const token = 'token-join-sitter-rejected';
    await seedInvite(token);

    const idToken = await getIdToken(SITTER_UID);
    await expect(
      callFunction('joinFamily', { token }, idToken),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'role-exclusive', profile: 'parent' },
    });

    const db = getDb();
    const after = (await db.collection('users').doc(SITTER_UID).get()).data()!;
    expect(after.profiles.parent).toBeUndefined();
    expect(after.profiles.babysitter.enrollmentComplete).toBe(true);

    const family = (await db.collection('families').doc(FAMILY_ID).get()).data()!;
    expect(family.parentIds).toEqual([EXISTING_PARENT]);

    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(false);
    expect(invite.usedByUserId).toBeUndefined();
  });

  it('rejects an already-used invite (authed, legal caller)', async () => {
    const token = 'token-join-used';
    await seedInvite(token, { used: true });

    const idToken = await getIdToken(PLAIN_UID);
    await expect(
      callFunction('joinFamily', { token }, idToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    // The profile-less caller is otherwise legal, so the used invite is the
    // only rejection cause — and no parent profile was added.
    const after = (await getDb().collection('users').doc(PLAIN_UID).get()).data()!;
    expect(after.profiles.parent).toBeUndefined();
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
