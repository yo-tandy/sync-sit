import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, FUNCTIONS_URL } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// createKidInvite / cancelKidInvite / resendKidInvite (guardian foundation).
//
// THE security property of this callable is anti-enumeration: the parent gets
// a byte-identical success response whether the kid has no account, an
// unsupervised account, or an account supervised by another family. The
// cross-branch response-identity test below asserts that on the RAW response
// bodies.

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

// An in-window grad year (validateEjmEmail accepts the school's 4-year
// window). The invited kid's DOB may say younger — this path deliberately has
// no DOB/grad-year consistency gate (supervision replaces gating).
const GRAD_13 = gradYearForExpectedAge(15);

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

function inviteInput(kidEmail: string, overrides: Record<string, unknown> = {}) {
  return {
    kidEmail,
    firstName: 'Zoe',
    lastName: 'Dupont',
    dateOfBirth: dobWithAge(13),
    consent: CONSENT,
    ...overrides,
  };
}

/**
 * Call createKidInvite and return the RAW response body text, so the
 * cross-branch identity assertion is byte-level, not shape-level.
 */
async function rawCreateKidInvite(
  data: Record<string, unknown>,
  authToken: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${FUNCTIONS_URL}/createKidInvite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: await res.text() };
}

async function seedKidAccount(
  uid: string,
  email: string,
  opts: { firstName?: string; lastName?: string; dobAge?: number } = {},
) {
  await getDb()
    .collection('users')
    .doc(uid)
    .set({
      uid,
      email: email.toLowerCase(),
      status: 'active',
      firstName: opts.firstName ?? 'Zoe',
      lastName: opts.lastName ?? 'Dupont',
      dateOfBirth: new Date(dobWithAge(opts.dobAge ?? 13)),
      language: 'en',
      profiles: {},
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
}

describe('createKidInvite', () => {
  let seed: SeedData;
  let parent1Token: string; // family1 (Dupont)
  let parent3Token: string; // family2 (Martin)
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  // ── user-visible rejections (none depend on the kid's account state) ──

  it('rejects an unauthenticated caller', async () => {
    await expect(
      callFunction('createKidInvite', inviteInput(`kid.a${GRAD_13}@ejm.org`)),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a caller without a parent profile', async () => {
    await expect(
      callFunction('createKidInvite', inviteInput(`kid.b${GRAD_13}@ejm.org`), babysitterToken),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { code: 'guardian/not-a-family-parent' },
    });
  });

  it('rejects a non-EJM email (safe rejection)', async () => {
    await expect(
      callFunction('createKidInvite', inviteInput('kid@gmail.com'), parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an EJM email with an invalid graduation year', async () => {
    await expect(
      callFunction('createKidInvite', inviteInput('kid99@ejm.org'), parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects stale consent versions', async () => {
    await expect(
      callFunction(
        'createKidInvite',
        inviteInput(`kid.c${GRAD_13}@ejm.org`, {
          consent: { ...CONSENT, supervisionAgreementVersion: '0.9' },
        }),
        parent1Token,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { code: 'guardian/stale-consent' },
    });
  });

  it('rejects missing consent', async () => {
    await expect(
      callFunction(
        'createKidInvite',
        inviteInput(`kid.d${GRAD_13}@ejm.org`, { consent: undefined }),
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a malformed dateOfBirth', async () => {
    await expect(
      callFunction(
        'createKidInvite',
        inviteInput(`kid.e${GRAD_13}@ejm.org`, { dateOfBirth: '2013-13-40' }),
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an empty firstName', async () => {
    await expect(
      callFunction(
        'createKidInvite',
        inviteInput(`kid.f${GRAD_13}@ejm.org`, { firstName: '  ' }),
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── branch a: no account → invite doc ──

  it('no-account branch creates a hashed-token invite with 7-day expiry', async () => {
    const email = `zoe.inv${GRAD_13}@ejm.org`;
    const before = Date.now();
    const result = await callFunction('createKidInvite', inviteInput(email), parent1Token);
    expect(result).toEqual({ success: true });

    const snap = await getDb()
      .collection('kidInvites')
      .where('kidEmailLower', '==', email)
      .get();
    expect(snap.size).toBe(1);
    const invite = snap.docs[0].data();
    expect(invite.kidEmailLower).toBe(email);
    expect(invite.firstName).toBe('Zoe');
    expect(invite.lastName).toBe('Dupont');
    expect(invite.dateOfBirth).toBe(dobWithAge(13));
    expect(invite.familyId).toBe(seed.family1Id);
    expect(invite.createdByParentUid).toBe(seed.parent1.uid);
    expect(invite.status).toBe('pending');
    // Raw token never stored — only its sha256 hex.
    expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.token).toBeUndefined();
    const expiresAt = invite.expiresAt.toDate().getTime();
    expect(expiresAt).toBeGreaterThan(before + 6.9 * 86400_000);
    expect(expiresAt).toBeLessThan(before + 7.1 * 86400_000);
    expect(invite.consent.tosVersion).toBe('1.0');
    expect(invite.consent.privacyVersion).toBe('1.0');
    expect(invite.consent.supervisionAgreementVersion).toBe('1.0');
    expect(invite.consent.approvedByUid).toBe(seed.parent1.uid);
    expect(invite.consent.approvedAt).toBeTruthy();

    // Audit written with the branch recorded.
    const audit = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'guardian.create_kid_invite')
      .get();
    const mine = audit.docs
      .map((d) => d.data())
      .filter((a) => a.details?.kidEmailLower === email);
    expect(mine.length).toBe(1);
    expect(mine[0].details.branch).toBe('invite_created');
  });

  it('a duplicate pending invite is treated as a resend: token rotates, expiry resets', async () => {
    const email = `zoe.dup${GRAD_13}@ejm.org`;
    await callFunction('createKidInvite', inviteInput(email), parent1Token);
    const first = (
      await getDb().collection('kidInvites').where('kidEmailLower', '==', email).get()
    ).docs[0].data();

    const result = await callFunction('createKidInvite', inviteInput(email), parent1Token);
    expect(result).toEqual({ success: true });

    const snap = await getDb().collection('kidInvites').where('kidEmailLower', '==', email).get();
    expect(snap.size).toBe(1); // still one doc — deduped
    const second = snap.docs[0].data();
    expect(second.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.tokenHash).not.toBe(first.tokenHash); // rotated
    expect(second.status).toBe('pending');
    expect(second.resentAt).toBeTruthy();
    expect(second.expiresAt.toDate().getTime()).toBeGreaterThanOrEqual(
      first.expiresAt.toDate().getTime(),
    );
  });

  // ── branch b: existing unsupervised account → silent claim ──

  it('existing-unsupervised branch creates a pending claim link, no invite, kid notified', async () => {
    const email = `zoe.claim${GRAD_13}@ejm.org`;
    await seedKidAccount('kidClaim1', email);

    const result = await callFunction('createKidInvite', inviteInput(email), parent1Token);
    expect(result).toEqual({ success: true });

    const link = (await getDb().collection('guardianLinks').doc('kidClaim1').get()).data()!;
    expect(link.childUid).toBe('kidClaim1');
    expect(link.familyId).toBe(seed.family1Id);
    expect(link.createdByParentUid).toBe(seed.parent1.uid);
    expect(link.status).toBe('pending');
    expect(link.origin).toBe('claim');
    expect(link.requestedAt).toBeTruthy();
    expect(link.confirmedAt).toBeUndefined();
    expect(link.consent.supervisionAgreementVersion).toBe('1.0');
    // Denormalized at creation so the kid-side card can name the family
    // without a families read (families are not child-readable).
    expect(link.familyName).toBe('Dupont');

    // A pending link must NOT set the governedBy mirror (present iff ACTIVE).
    const kid = (await getDb().collection('users').doc('kidClaim1').get()).data()!;
    expect(kid.governedBy).toBeUndefined();
    // Existing accounts never get identityLocked, and the parent-entered
    // name/DOB are NOT applied.
    expect(kid.identityLocked).toBeUndefined();

    // No invite doc was created for this email.
    const invites = await getDb().collection('kidInvites').where('kidEmailLower', '==', email).get();
    expect(invites.size).toBe(0);

    // The kid got an in-app notification.
    const notifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', 'kidClaim1')
      .get();
    expect(notifs.size).toBe(1);
    expect(notifs.docs[0].data().type).toBe('supervision_request');
  });

  it('re-asking while the same-family claim is pending is idempotent (one link, refreshed)', async () => {
    const email = `zoe.reask${GRAD_13}@ejm.org`;
    await seedKidAccount('kidReask', email);
    await callFunction('createKidInvite', inviteInput(email), parent1Token);
    const first = (await getDb().collection('guardianLinks').doc('kidReask').get()).data()!;

    const result = await callFunction('createKidInvite', inviteInput(email), parent1Token);
    expect(result).toEqual({ success: true });

    const second = (await getDb().collection('guardianLinks').doc('kidReask').get()).data()!;
    expect(second.status).toBe('pending');
    expect(second.familyId).toBe(seed.family1Id);
    expect(second.requestedAt.toDate().getTime()).toBeGreaterThanOrEqual(
      first.requestedAt.toDate().getTime(),
    );
  });

  it('a materially mismatching claim also writes a QUIET admin alert', async () => {
    const email = `zoe.mismatch${GRAD_13}@ejm.org`;
    // Account says 17-year-old named Lena Katz; parent enters 13-year-old Zoe Dupont.
    await seedKidAccount('kidMismatch', email, {
      firstName: 'Lena',
      lastName: 'Katz',
      dobAge: 17,
    });

    const result = await callFunction('createKidInvite', inviteInput(email), parent1Token);
    expect(result).toEqual({ success: true });

    // Claim link still created (the kid decides) …
    const link = (await getDb().collection('guardianLinks').doc('kidMismatch').get()).data()!;
    expect(link.status).toBe('pending');
    // … but the identity mismatch is surfaced to admin, silently.
    const alerts = await getDb()
      .collection('adminAlerts')
      .where('type', '==', 'guardian_claim_identity_mismatch')
      .get();
    const mine = alerts.docs.map((d) => d.data()).filter((a) => a.data?.kidEmailLower === email);
    expect(mine.length).toBe(1);
  });

  // ── branch c: supervised by ANOTHER family → admin alert only ──

  it('conflicting-family branch writes an admin alert and creates NOTHING else', async () => {
    const email = `zoe.conflict${GRAD_13}@ejm.org`;
    await seedKidAccount('kidConflict', email);
    // Already actively supervised by family2.
    await getDb().collection('guardianLinks').doc('kidConflict').set({
      childUid: 'kidConflict',
      familyId: seed.family2Id,
      createdByParentUid: seed.parent3.uid,
      status: 'active',
      origin: 'claim',
      requestedAt: new Date(),
      confirmedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent3.uid },
    });

    const result = await callFunction('createKidInvite', inviteInput(email), parent1Token);
    expect(result).toEqual({ success: true }); // the probing parent learns nothing

    // The existing link is untouched.
    const link = (await getDb().collection('guardianLinks').doc('kidConflict').get()).data()!;
    expect(link.familyId).toBe(seed.family2Id);
    expect(link.status).toBe('active');

    // No invite doc, no notification to the kid.
    const invites = await getDb().collection('kidInvites').where('kidEmailLower', '==', email).get();
    expect(invites.size).toBe(0);
    const notifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', 'kidConflict')
      .get();
    expect(notifs.size).toBe(0);

    // Admin alert with the conflict payload.
    const alerts = await getDb()
      .collection('adminAlerts')
      .where('type', '==', 'guardian_conflicting_claim')
      .get();
    const mine = alerts.docs.map((d) => d.data()).filter((a) => a.data?.kidEmailLower === email);
    expect(mine.length).toBe(1);
    expect(mine[0].data).toMatchObject({
      attemptedByUid: seed.parent1.uid,
      familyId: seed.family1Id,
      kidEmailLower: email,
      existingLinkFamilyId: seed.family2Id,
    });
  });

  it('same-family-already-active branch is a no-op success', async () => {
    const email = `zoe.active${GRAD_13}@ejm.org`;
    await seedKidAccount('kidActive', email);
    await getDb().collection('guardianLinks').doc('kidActive').set({
      childUid: 'kidActive',
      familyId: seed.family1Id,
      createdByParentUid: seed.parent1.uid,
      status: 'active',
      origin: 'claim',
      requestedAt: new Date(),
      confirmedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
    });
    const before = (await getDb().collection('guardianLinks').doc('kidActive').get()).data()!;

    const result = await callFunction('createKidInvite', inviteInput(email), parent1Token);
    expect(result).toEqual({ success: true });

    const after = (await getDb().collection('guardianLinks').doc('kidActive').get()).data()!;
    expect(after).toEqual(before); // untouched
  });

  // ── THE anti-enumeration test: raw response bodies are byte-identical ──

  it('returns a byte-identical raw response across ALL account-state branches', async () => {
    // Branch a: no account.
    const noAccount = await rawCreateKidInvite(
      inviteInput(`ident.a${GRAD_13}@ejm.org`),
      parent1Token,
    );
    // Branch a-bis: duplicate pending invite (dedup-resend).
    const dedupResend = await rawCreateKidInvite(
      inviteInput(`ident.a${GRAD_13}@ejm.org`),
      parent1Token,
    );
    // Branch b: existing unsupervised account.
    await seedKidAccount('kidIdentB', `ident.b${GRAD_13}@ejm.org`);
    const claim = await rawCreateKidInvite(
      inviteInput(`ident.b${GRAD_13}@ejm.org`),
      parent1Token,
    );
    // Branch c: supervised by ANOTHER family.
    await seedKidAccount('kidIdentC', `ident.c${GRAD_13}@ejm.org`);
    await getDb().collection('guardianLinks').doc('kidIdentC').set({
      childUid: 'kidIdentC',
      familyId: seed.family2Id,
      createdByParentUid: seed.parent3.uid,
      status: 'active',
      origin: 'claim',
      requestedAt: new Date(),
      confirmedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent3.uid },
    });
    const conflict = await rawCreateKidInvite(
      inviteInput(`ident.c${GRAD_13}@ejm.org`),
      parent1Token,
    );
    // Branch d: same family already active.
    await seedKidAccount('kidIdentD', `ident.d${GRAD_13}@ejm.org`);
    await getDb().collection('guardianLinks').doc('kidIdentD').set({
      childUid: 'kidIdentD',
      familyId: seed.family1Id,
      createdByParentUid: seed.parent1.uid,
      status: 'active',
      origin: 'claim',
      requestedAt: new Date(),
      confirmedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
    });
    const activeSame = await rawCreateKidInvite(
      inviteInput(`ident.d${GRAD_13}@ejm.org`),
      parent1Token,
    );

    for (const res of [noAccount, dedupResend, claim, conflict, activeSame]) {
      expect(res.status).toBe(200);
    }
    // Byte-identical bodies — deep equality is implied, ordering included.
    expect(dedupResend.body).toBe(noAccount.body);
    expect(claim.body).toBe(noAccount.body);
    expect(conflict.body).toBe(noAccount.body);
    expect(activeSame.body).toBe(noAccount.body);
    expect(JSON.parse(noAccount.body)).toEqual({ result: { success: true } });
  });
});

describe('cancelKidInvite / resendKidInvite', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent2Token: string; // co-parent, family1
  let parent3Token: string; // family2
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent2Token = await getIdToken(seed.parent2.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  async function createInvite(email: string): Promise<string> {
    await callFunction(
      'createKidInvite',
      {
        kidEmail: email,
        firstName: 'Zoe',
        lastName: 'Dupont',
        dateOfBirth: dobWithAge(13),
        consent: CONSENT,
      },
      parent1Token,
    );
    const snap = await getDb().collection('kidInvites').where('kidEmailLower', '==', email).get();
    return snap.docs[0].id;
  }

  it('a family parent can cancel a pending invite', async () => {
    const id = await createInvite(`cr.a${GRAD_13}@ejm.org`);
    const result = await callFunction('cancelKidInvite', { inviteId: id }, parent1Token);
    expect(result).toEqual({ success: true });
    const invite = (await getDb().collection('kidInvites').doc(id).get()).data()!;
    expect(invite.status).toBe('cancelled');
  });

  it('the co-parent can cancel too (family-level rights)', async () => {
    const id = await createInvite(`cr.b${GRAD_13}@ejm.org`);
    await callFunction('cancelKidInvite', { inviteId: id }, parent2Token);
    const invite = (await getDb().collection('kidInvites').doc(id).get()).data()!;
    expect(invite.status).toBe('cancelled');
  });

  it('a parent from another family cannot cancel', async () => {
    const id = await createInvite(`cr.c${GRAD_13}@ejm.org`);
    await expect(
      callFunction('cancelKidInvite', { inviteId: id }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('a non-parent cannot cancel', async () => {
    const id = await createInvite(`cr.d${GRAD_13}@ejm.org`);
    await expect(
      callFunction('cancelKidInvite', { inviteId: id }, babysitterToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('cancelling a cancelled invite fails (failed-precondition)', async () => {
    const id = await createInvite(`cr.e${GRAD_13}@ejm.org`);
    await callFunction('cancelKidInvite', { inviteId: id }, parent1Token);
    await expect(
      callFunction('cancelKidInvite', { inviteId: id }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('resend rotates the token, resets the 7-day clock, and stamps resentAt', async () => {
    const id = await createInvite(`cr.f${GRAD_13}@ejm.org`);
    const before = (await getDb().collection('kidInvites').doc(id).get()).data()!;
    const t0 = Date.now();
    const result = await callFunction('resendKidInvite', { inviteId: id }, parent1Token);
    expect(result).toEqual({ success: true });
    const after = (await getDb().collection('kidInvites').doc(id).get()).data()!;
    expect(after.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.resentAt).toBeTruthy();
    expect(after.status).toBe('pending');
    expect(after.expiresAt.toDate().getTime()).toBeGreaterThan(t0 + 6.9 * 86400_000);
  });

  it('resend UN-expires an invite whose expiry has passed (the recovery path)', async () => {
    const id = await createInvite(`cr.g${GRAD_13}@ejm.org`);
    await getDb()
      .collection('kidInvites')
      .doc(id)
      .update({ expiresAt: new Date(Date.now() - 86400_000) });
    await callFunction('resendKidInvite', { inviteId: id }, parent1Token);
    const after = (await getDb().collection('kidInvites').doc(id).get()).data()!;
    expect(after.status).toBe('pending');
    expect(after.expiresAt.toDate().getTime()).toBeGreaterThan(Date.now() + 6.9 * 86400_000);
  });

  it('a cancelled invite cannot be resent', async () => {
    const id = await createInvite(`cr.h${GRAD_13}@ejm.org`);
    await callFunction('cancelKidInvite', { inviteId: id }, parent1Token);
    await expect(
      callFunction('resendKidInvite', { inviteId: id }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('a parent from another family cannot resend', async () => {
    const id = await createInvite(`cr.i${GRAD_13}@ejm.org`);
    await expect(
      callFunction('resendKidInvite', { inviteId: id }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('an unknown inviteId is not-found', async () => {
    await expect(
      callFunction('cancelKidInvite', { inviteId: 'nope' }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
