import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// redeemKidInvite: the kid turns a parent-created invite into a supervised
// account. Every failure mode returns ONE generic error — the token is the
// only capability, and its failure reason must not leak invite state.

function schoolYearEnd(): number {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}
const GRAD = (schoolYearEnd() + 3) % 100; // in-window grad year

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

const PASSWORD = 'Str0ngPass1';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const AUTH_URL = `http://127.0.0.1:${process.env.TEST_AUTH_PORT ?? '9099'}`;

/** Prove the created credentials actually work (the client sign-in contract). */
async function signInWithPassword(email: string, password: string) {
  const res = await fetch(
    `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return res.json();
}

describe('redeemKidInvite', () => {
  let seed: SeedData;
  let parent1Token: string;
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  /**
   * Create a real invite through the callable, then plant a KNOWN token hash
   * (the raw token only ever exists in the invite email, which the emulator
   * just logs — so tests take over the token slot instead).
   */
  async function createInviteWithToken(): Promise<{
    inviteId: string;
    email: string;
    token: string;
  }> {
    counter += 1;
    const email = `redeem.kid${counter}g${GRAD}@ejm.org`;
    await callFunction(
      'createKidInvite',
      {
        kidEmail: email,
        firstName: 'Zoe',
        lastName: 'Dupont',
        dateOfBirth: '2013-05-01',
        consent: CONSENT,
      },
      parent1Token,
    );
    const snap = await getDb().collection('kidInvites').where('kidEmailLower', '==', email).get();
    const inviteId = snap.docs[0].id;
    const token = `known-token-${counter}`;
    await getDb().collection('kidInvites').doc(inviteId).update({ tokenHash: sha256(token) });
    return { inviteId, email, token };
  }

  const GENERIC = {
    code: 'NOT_FOUND',
    details: { code: 'guardian/invalid-invite' },
  };

  it('happy path: creates the supervised account, active link, accepted invite', async () => {
    const { inviteId, email, token } = await createInviteWithToken();
    const before = new Date();

    const result = await callFunction<{ success: boolean; uid: string }>('redeemKidInvite', {
      token,
      password: PASSWORD,
    });
    expect(result.success).toBe(true);
    expect(result.uid).toBeTruthy();
    const uid = result.uid;

    // Auth user exists with the invite identity, and the password works.
    const authUser = await getAdminAuth().getUserByEmail(email);
    expect(authUser.uid).toBe(uid);
    expect(authUser.displayName).toBe('Zoe');
    const signIn = await signInWithPassword(email, PASSWORD);
    expect(signIn.idToken).toBeTruthy();
    expect(signIn.localId).toBe(uid);

    // users doc: invite identity, locked, governed.
    const user = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(user.uid).toBe(uid);
    expect(user.email).toBe(email);
    expect(user.firstName).toBe('Zoe');
    expect(user.lastName).toBe('Dupont');
    expect(user.dateOfBirth.toDate().toISOString().slice(0, 10)).toBe('2013-05-01');
    expect(user.status).toBe('active');
    expect(user.profiles).toEqual({});
    expect(user.identityLocked).toBe(true);
    expect(user.governedBy.familyId).toBe(seed.family1Id);
    expect(user.governedBy.linkedAt).toBeTruthy();
    expect(user.consentVersion).toBe('1.0');
    expect(user.consentAt).toBeTruthy();
    expect(user.language).toBeTruthy();
    expect(user.notifPrefs).toBeTruthy();

    // guardianLinks/{uid}: ACTIVE, parent_created, consent copied verbatim.
    const invite = (await getDb().collection('kidInvites').doc(inviteId).get()).data()!;
    const link = (await getDb().collection('guardianLinks').doc(uid).get()).data()!;
    expect(link.childUid).toBe(uid);
    expect(link.familyId).toBe(seed.family1Id);
    expect(link.createdByParentUid).toBe(seed.parent1.uid);
    expect(link.status).toBe('active');
    expect(link.origin).toBe('parent_created');
    expect(link.requestedAt.toDate().getTime()).toBe(invite.createdAt.toDate().getTime());
    expect(link.confirmedAt.toDate().getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
    expect(link.consent.tosVersion).toBe(invite.consent.tosVersion);
    expect(link.consent.privacyVersion).toBe(invite.consent.privacyVersion);
    expect(link.consent.supervisionAgreementVersion).toBe(
      invite.consent.supervisionAgreementVersion,
    );
    expect(link.consent.approvedByUid).toBe(seed.parent1.uid);
    expect(link.consent.approvedAt.toDate().getTime()).toBe(
      invite.consent.approvedAt.toDate().getTime(),
    );

    // Invite consumed.
    expect(invite.status).toBe('accepted');

    // The supervising family's parents were notified (in-app docs).
    const notifs = await getDb()
      .collection('notifications')
      .where('type', '==', 'guardian_invite_accepted')
      .get();
    const recipients = notifs.docs.map((d) => d.data().recipientUserId).sort();
    expect(recipients).toEqual([seed.parent1.uid, seed.parent2.uid].sort());
  });

  it('an unknown token fails with the generic error', async () => {
    await expect(
      callFunction('redeemKidInvite', { token: 'no-such-token', password: PASSWORD }),
    ).rejects.toMatchObject(GENERIC);
  });

  it('an expired invite fails generically AND is marked expired', async () => {
    const { inviteId, token } = await createInviteWithToken();
    await getDb()
      .collection('kidInvites')
      .doc(inviteId)
      .update({ expiresAt: new Date(Date.now() - 60_000) });

    await expect(
      callFunction('redeemKidInvite', { token, password: PASSWORD }),
    ).rejects.toMatchObject(GENERIC);

    const invite = (await getDb().collection('kidInvites').doc(inviteId).get()).data()!;
    expect(invite.status).toBe('expired');
  });

  it('a cancelled invite fails with the same generic error', async () => {
    const { inviteId, token } = await createInviteWithToken();
    await callFunction('cancelKidInvite', { inviteId }, parent1Token);

    await expect(
      callFunction('redeemKidInvite', { token, password: PASSWORD }),
    ).rejects.toMatchObject(GENERIC);
  });

  it('a token cannot be reused after redemption', async () => {
    const { token } = await createInviteWithToken();
    await callFunction('redeemKidInvite', { token, password: PASSWORD });
    await expect(
      callFunction('redeemKidInvite', { token, password: PASSWORD }),
    ).rejects.toMatchObject(GENERIC);
  });

  it('all failure modes share ONE indistinguishable error shape', async () => {
    const failures: Array<{ code: string; message: string; details: unknown }> = [];
    const capture = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        throw new Error('expected rejection');
      } catch (err) {
        const e = err as Error & { code: string; details?: unknown };
        failures.push({ code: e.code, message: e.message, details: e.details });
      }
    };

    await capture(() => callFunction('redeemKidInvite', { token: 'bogus', password: PASSWORD }));
    const expired = await createInviteWithToken();
    await getDb()
      .collection('kidInvites')
      .doc(expired.inviteId)
      .update({ expiresAt: new Date(Date.now() - 60_000) });
    await capture(() => callFunction('redeemKidInvite', { token: expired.token, password: PASSWORD }));
    const cancelled = await createInviteWithToken();
    await callFunction('cancelKidInvite', { inviteId: cancelled.inviteId }, parent1Token);
    await capture(() =>
      callFunction('redeemKidInvite', { token: cancelled.token, password: PASSWORD }),
    );

    expect(failures).toHaveLength(3);
    for (const f of failures.slice(1)) {
      expect(f).toEqual(failures[0]);
    }
  });

  it('rejects a weak password without consuming the invite', async () => {
    const { inviteId, token } = await createInviteWithToken();
    await expect(
      callFunction('redeemKidInvite', { token, password: 'weak' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const invite = (await getDb().collection('kidInvites').doc(inviteId).get()).data()!;
    expect(invite.status).toBe('pending'); // still redeemable with a good password
  });

  it('kid self-enrolled in the window: invite is cancelled, generic error', async () => {
    const { inviteId, email, token } = await createInviteWithToken();
    // The kid created their own account after the invite went out.
    await getAdminAuth().createUser({ email, password: 'Other0Pass' });

    await expect(
      callFunction('redeemKidInvite', { token, password: PASSWORD }),
    ).rejects.toMatchObject(GENERIC);

    const invite = (await getDb().collection('kidInvites').doc(inviteId).get()).data()!;
    expect(invite.status).toBe('cancelled');
    // No users doc (and hence no link) was created for the kid's email.
    const users = await getDb().collection('users').where('email', '==', email).get();
    expect(users.size).toBe(0);
  });
});
