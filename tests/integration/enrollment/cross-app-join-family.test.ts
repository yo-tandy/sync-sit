import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken, getAdminAuth } from '../../setup/emulator.js';

const TUTOR_UID = 'standalone-tutor-3';
const TUTOR_EMAIL = 'tutoronly3@test.com';
const SITTER_UID = 'standalone-sitter-3';
const SITTER_EMAIL = 'sitteronly3@test.com';
const PLAIN_UID = 'standalone-plain-3';
const PLAIN_EMAIL = 'plainonly3@test.com';
const PLAIN2_UID = 'standalone-plain-4';
const PLAIN2_EMAIL = 'plainonly4@test.com';
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

    // A second profile-less account, so the concurrency pin has two DISTINCT
    // legal callers racing one link (same-caller races would be rejected by
    // the parent-profile guard rather than by the claim).
    await getAdminAuth().createUser({ uid: PLAIN2_UID, email: PLAIN2_EMAIL });
    await db.collection('users').doc(PLAIN2_UID).set({
      uid: PLAIN2_UID,
      email: PLAIN2_EMAIL,
      firstName: 'Ping',
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

  it('a profile-less signed-in account CAN still join as a parent (positive add-profile pin)', async () => {
    const db = getDb();
    const token = 'token-join-plain-positive';
    await seedInvite(token);

    const idToken = await getIdToken(PLAIN_UID);
    const result = await callFunction<{ familyId: string }>('joinFamily', { token }, idToken);
    expect(result.familyId).toBe(FAMILY_ID);

    // profiles.parent added, invite consumed, family membership recorded —
    // the exclusivity guard must not over-block the legal path.
    const after = (await db.collection('users').doc(PLAIN_UID).get()).data()!;
    expect(after.profiles.parent.familyId).toBe(FAMILY_ID);
    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(true);
    const family = (await db.collection('families').doc(FAMILY_ID).get()).data()!;
    expect(family.parentIds).toContain(PLAIN_UID);

    // Restore the plain fixture for the sibling tests (order-independent).
    await db.collection('users').doc(PLAIN_UID).set({ profiles: {} }, { mergeFields: ['profiles'] });
    await db.collection('families').doc(FAMILY_ID).update({
      parentIds: family.parentIds.filter((id: string) => id !== PLAIN_UID),
    });
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

  // ── Single-use enforcement under concurrency (the invite-claim lease) ──
  //
  // `used` was read at step 1 and written at step 7, with Auth creation, the
  // user-doc write and the parentIds arrayUnion in between and no transaction
  // anywhere: two overlapping redemptions of one link both passed the check
  // and both joined the family. The consume could not simply move to the
  // front — step 5's ordering exists so a FAILED attempt leaves the link
  // usable — so redemption now takes a short lease instead.

  it('rejects a redemption while another holds a LIVE claim on the link', async () => {
    const token = 'token-join-claimed-live';
    await seedInvite(token, { claimedAt: new Date(), claimId: 'someone-elses-claim' });

    const idToken = await getIdToken(PLAIN_UID);
    await expect(
      callFunction('joinFamily', { token }, idToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    // The caller is otherwise legal, so the claim is the only rejection cause.
    const after = (await getDb().collection('users').doc(PLAIN_UID).get()).data()!;
    expect(after.profiles.parent).toBeUndefined();
    // And the holder's claim is untouched — a rejected redemption must never
    // release a lease it does not own.
    const invite = (await getDb().collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.claimId).toBe('someone-elses-claim');
  });

  it('a STALE claim is takeable — a crashed redemption cannot burn the link', async () => {
    const db = getDb();
    const token = 'token-join-claimed-stale';
    // Older than INVITE_CLAIM_TTL_MS (2 min): the holder died mid-redemption.
    await seedInvite(token, {
      claimedAt: new Date(Date.now() - 5 * 60 * 1000),
      claimId: 'dead-invocation',
    });

    const idToken = await getIdToken(PLAIN_UID);
    const result = await callFunction<{ familyId: string }>('joinFamily', { token }, idToken);
    expect(result.familyId).toBe(FAMILY_ID);

    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(true);
    // The lease fields are cleared on consume, not left behind as litter.
    expect(invite.claimedAt).toBeUndefined();
    expect(invite.claimId).toBeUndefined();

    // Restore the shared fixtures (order-independent, like the positive pin).
    await db.collection('users').doc(PLAIN_UID).set({ profiles: {} }, { mergeFields: ['profiles'] });
    const family = (await db.collection('families').doc(FAMILY_ID).get()).data()!;
    await db.collection('families').doc(FAMILY_ID).update({
      parentIds: family.parentIds.filter((id: string) => id !== PLAIN_UID),
    });
  });

  it('a FAILED redemption releases its claim, leaving the link fully usable', async () => {
    // The property step 5's ordering was protecting, now stated directly:
    // after a rejection the link must carry no lease, not merely used:false.
    const db = getDb();
    const token = 'token-join-release-on-failure';
    await seedInvite(token);

    // 'already-parent-2' is rejected by the parent-profile guard, which fires
    // AFTER the claim is taken — exactly the window that must self-clean.
    const uid = 'already-parent-release';
    await getAdminAuth().createUser({ uid, email: 'alreadyparentrel@test.com' });
    await db.collection('users').doc(uid).set({
      uid,
      email: 'alreadyparentrel@test.com',
      status: 'active',
      profiles: { parent: { enrollmentComplete: true, familyId: 'f-existing' } },
    });

    await expect(
      callFunction('joinFamily', { token }, await getIdToken(uid)),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });

    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(false);
    expect(invite.claimedAt).toBeUndefined();
    expect(invite.claimId).toBeUndefined();

    // Proof the release is real and not just field-shaped: a legal caller can
    // immediately redeem the same link.
    const result = await callFunction<{ familyId: string }>(
      'joinFamily', { token }, await getIdToken(PLAIN_UID),
    );
    expect(result.familyId).toBe(FAMILY_ID);

    await db.collection('users').doc(PLAIN_UID).set({ profiles: {} }, { mergeFields: ['profiles'] });
    const family = (await db.collection('families').doc(FAMILY_ID).get()).data()!;
    await db.collection('families').doc(FAMILY_ID).update({
      parentIds: family.parentIds.filter((id: string) => id !== PLAIN_UID),
    });
  });

  it('two simultaneous redemptions of ONE link add exactly one parent', async () => {
    // The end-to-end shape of the defect. NOTE this is a smoke test, not a
    // proof: it depends on the two calls actually overlapping in the emulator,
    // so it can pass for the wrong reason. The deterministic guarantees are
    // the live-claim and stale-claim pins above, which do not rely on timing.
    const db = getDb();
    const token = 'token-join-concurrent';
    await seedInvite(token);

    const [tokenA, tokenB] = await Promise.all([getIdToken(PLAIN_UID), getIdToken(PLAIN2_UID)]);
    const results = await Promise.allSettled([
      callFunction<{ familyId: string }>('joinFamily', { token }, tokenA),
      callFunction<{ familyId: string }>('joinFamily', { token }, tokenB),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const family = (await db.collection('families').doc(FAMILY_ID).get()).data()!;
    const joined = [PLAIN_UID, PLAIN2_UID].filter((id) => family.parentIds.includes(id));
    expect(joined).toHaveLength(1);

    const invite = (await db.collection('inviteLinks').doc(token).get()).data()!;
    expect(invite.used).toBe(true);
    expect(invite.usedByUserId).toBe(joined[0]);

    for (const id of [PLAIN_UID, PLAIN2_UID]) {
      await db.collection('users').doc(id).set({ profiles: {} }, { mergeFields: ['profiles'] });
    }
    await db.collection('families').doc(FAMILY_ID).update({
      parentIds: family.parentIds.filter((id: string) => !joined.includes(id)),
    });
  });
});
