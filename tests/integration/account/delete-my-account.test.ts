import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHash } from 'crypto';
import {
  clearAll,
  callFunction,
  getIdToken,
  exchangeCustomToken,
  getDb,
  getAdminAuth,
} from '../../setup/emulator.js';
import {
  seedTestData,
  seedAppointment,
  seedStudySession,
  type SeedData,
} from '../../setup/seed.js';

/**
 * deleteMyAccount: the member's own irreversible erasure (issue #368).
 *
 * The guards are pinned as pure logic in the shared-functions unit suite; this
 * file covers everything that only exists once Firestore and Auth are real —
 * that the erasure ACTUALLY runs for a self-caller, that the supervising
 * family is still reachable at the moment the guardian is told, that
 * `guardiansFound` counts the guardians the family names, and that a cross-app
 * handoff cannot hand a stale session a fresh re-auth window.
 *
 * NOT covered here, and the reason is recorded at the test that would have
 * claimed it: `guardiansReached` counting DELIVERIES rather than iterations is
 * unstageable against the emulator. That half lives in
 * packages/shared-functions/src/account/__tests__/guardianNotifyCounts.test.ts.
 *
 * Every "it deleted X" assertion is a READ-BACK against the emulator. Deletion
 * work in this repo has shipped more than once with a check that measured
 * nothing (a Storage erasure that removed zero objects under a passing test),
 * so nothing here trusts a callable's own return value as evidence that data
 * is gone.
 *
 * The supervised child is built by CALLING createKidInvite + redeemKidInvite,
 * not by seeding a fixture: the shape under test is then whatever production
 * actually writes. (PR #396's defect was a fixture that seeded `undefined`
 * where all three production writers wrote explicit `null`.)
 */

const AUTH_URL = `http://127.0.0.1:${process.env.TEST_AUTH_PORT ?? '9099'}`;
const PASSWORD = 'Str0ngPass1';

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

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** A 'YYYY-MM-DD' `n` days from now (negative = past). */
function dateIn(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

/** A real sign-in — the only way to get a token with a genuine `auth_time`. */
async function signInWithPassword(email: string, password: string): Promise<string> {
  const res = await fetch(
    `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string; error?: unknown };
  if (!body.idToken) {
    throw new Error(`signInWithPassword failed: ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

/** Claims of an emulator-issued ID token (unsigned JWT). */
function claimsOf(idToken: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
}

describe('deleteMyAccount', () => {
  let seed: SeedData;
  let counter = 0;

  // A self-delete makes the whole seed inconsistent, so every test re-seeds
  // (same reason deleteUser's suite does).
  beforeEach(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  /**
   * A supervised minor of family1, created entirely through the production
   * callables: the parent mints a real invite, the kid redeems it. Nothing
   * about the users doc, the guardianLink or the governedBy mirror is
   * fabricated here.
   *
   * The raw invite token exists only in the invite email (the emulator just
   * logs it), so the test plants a known hash in the token slot — the same
   * move redeem-kid-invite.test.ts makes.
   */
  async function createSupervisedChild(): Promise<{ uid: string; email: string }> {
    counter += 1;
    const parentToken = await getIdToken(seed.parent1.uid);
    const email = `selfdel.kid${counter}g${GRAD}@ejm.org`;
    await callFunction(
      'createKidInvite',
      {
        kidEmail: email,
        firstName: 'Zoe',
        lastName: 'Dupont',
        dateOfBirth: '2013-05-01',
        consent: CONSENT,
      },
      parentToken,
    );
    const snap = await getDb().collection('kidInvites').where('kidEmailLower', '==', email).get();
    const token = `known-token-${counter}`;
    await snap.docs[0].ref.update({ tokenHash: sha256(token) });

    const redeemed = await callFunction<{ uid: string }>('redeemKidInvite', {
      token,
      password: PASSWORD,
    });

    // The fixture is only worth building if it is the state under test.
    const link = (await getDb().collection('guardianLinks').doc(redeemed.uid).get()).data();
    expect(link?.status).toBe('active');
    expect(link?.familyId).toBe(seed.family1Id);
    return { uid: redeemed.uid, email };
  }

  async function auditEntry(uid: string): Promise<Record<string, unknown> | undefined> {
    const snap = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'self_delete_account')
      .where('targetUserId', '==', uid)
      .get();
    expect(snap.size).toBeLessThanOrEqual(1);
    return snap.docs[0]?.data();
  }

  async function guardianNotices(): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
    const snap = await getDb()
      .collection('notifications')
      .where('type', '==', 'supervised_account_deleted')
      .get();
    return snap.docs;
  }

  describe('guards', () => {
    it('refuses an unauthenticated call', async () => {
      await expect(callFunction('deleteMyAccount', { confirm: 'DELETE' })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it.each([
      ['no payload at all', {}],
      ['the wrong word', { confirm: 'delete my account' }],
      ['the right word in the wrong case', { confirm: 'delete' }],
      ['a localised word', { confirm: 'SUPPRIMER' }],
    ])('refuses %s, and the account survives', async (_label, payload) => {
      const token = await getIdToken(seed.babysitter1.uid);
      await expect(callFunction('deleteMyAccount', payload, token)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });

      // The point of the guard is that nothing happened, not that an error was
      // returned — so read the account back.
      expect((await getDb().collection('users').doc(seed.babysitter1.uid).get()).exists).toBe(true);
      const authUser = await getAdminAuth().getUser(seed.babysitter1.uid);
      expect(authUser.uid).toBe(seed.babysitter1.uid);
    });

    it('emulator ID tokens really do carry auth_time (the guard is not vacuous here)', async () => {
      // If auth_time were absent, assertSelfDeleteAllowed would fail closed and
      // EVERY test below would be asserting on a rejected call. Pin the
      // precondition explicitly rather than let it hide.
      const claims = claimsOf(await getIdToken(seed.babysitter1.uid));
      expect(typeof claims.auth_time).toBe('number');
      expect(Number(claims.auth_time)).toBeGreaterThan(0);
    });

    it('refuses a member whose user doc is already gone', async () => {
      const authUser = await getAdminAuth().createUser({
        email: `ghost.doc${Date.now()}@ejm.org`,
        password: PASSWORD,
      });
      const token = await getIdToken(authUser.uid);
      await expect(
        callFunction('deleteMyAccount', { confirm: 'DELETE' }, token),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('the erasure actually runs', () => {
    it('erases an unsupervised member: appointments, schedule, user doc, auth account', async () => {
      const db = getDb();
      const apptPending = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
      });
      const apptConfirmed = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
      });
      await db
        .collection('schedules')
        .doc(seed.babysitter1.uid)
        .collection('overrides')
        .doc('override-1')
        .set({ date: '2026-12-25', slots: [] });
      await db.collection('notifications').add({
        recipientUserId: seed.babysitter1.uid,
        type: 'new_request',
        createdAt: new Date(),
      });

      const token = await getIdToken(seed.babysitter1.uid);
      const result = await callFunction<{ success: boolean; cancelledAppointments: number }>(
        'deleteMyAccount',
        { confirm: 'DELETE' },
        token,
      );
      expect(result.success).toBe(true);
      expect(result.cancelledAppointments).toBe(2);

      // Read-backs — the return value above is the code's own claim, not proof.
      for (const id of [apptPending, apptConfirmed]) {
        const appt = (await db.collection('appointments').doc(id).get()).data()!;
        expect(appt.babysitterUserId).toBe('deleted');
        expect(appt.status).toBe('cancelled');
        expect(appt.statusReason).toBe('account_deleted');
      }
      expect((await db.collection('schedules').doc(seed.babysitter1.uid).get()).exists).toBe(false);
      expect(
        (
          await db
            .collection('schedules')
            .doc(seed.babysitter1.uid)
            .collection('overrides')
            .get()
        ).empty,
      ).toBe(true);
      expect(
        (
          await db
            .collection('notifications')
            .where('recipientUserId', '==', seed.babysitter1.uid)
            .get()
        ).empty,
      ).toBe(true);
      expect((await db.collection('users').doc(seed.babysitter1.uid).get()).exists).toBe(false);
      await expect(getAdminAuth().getUser(seed.babysitter1.uid)).rejects.toMatchObject({
        code: 'auth/user-not-found',
      });
    });

    it('audits the self-delete with the MEMBER as actor, and no guardian counts', async () => {
      const token = await getIdToken(seed.babysitter1.uid);
      await callFunction('deleteMyAccount', { confirm: 'DELETE' }, token);

      const entry = await auditEntry(seed.babysitter1.uid);
      expect(entry).toBeTruthy();
      // There is no second person who witnessed this, so the actor field must
      // name the member themselves — not an admin, not 'system'.
      expect(entry!.adminUserId).toBe(seed.babysitter1.uid);
      expect(entry!.targetUserId).toBe(seed.babysitter1.uid);
      const details = entry!.details as Record<string, unknown>;
      expect(details.email).toBe(seed.babysitter1.email);
      expect(details.wasSupervised).toBe(false);
      expect(details.guardiansFound).toBe(0);
      expect(details.guardiansReached).toBe(0);
      expect(await guardianNotices()).toHaveLength(0);
    });

    it('records the same erasure counts the admin path does, including erasureFailures', async () => {
      // `eraseUserAccount` returns these so the CALLER owns the audit trail —
      // and there are two callers. `deleteUser` consumed them from the start;
      // this path did not, which meant a partial erasure on a self-delete left
      // personal data behind with nobody aware of it. The account is gone by
      // then, so the erasure cannot be re-run: the number IS the alarm.
      const db = getDb();
      await seedStudySession({
        familyId: seed.family1Id,
        tutorUserId: seed.tutor1.uid,
        status: 'confirmed',
        date: dateIn(5),
      });

      await callFunction(
        'deleteMyAccount',
        { confirm: 'DELETE' },
        await getIdToken(seed.tutor1.uid),
      );

      const details = (await auditEntry(seed.tutor1.uid))!.details as Record<string, unknown>;
      expect(details.anonymizedStudySessions).toBe(1);
      expect(details.cancelledStudySessions).toBe(1);
      expect(details.erasureFailures).toBe(0);
      // Present, not merely non-zero: a missing key reads as "nothing failed"
      // exactly like a zero does, which is the regression this pins.
      for (const key of [
        'deletedScheduleOverrides',
        'releasedAppointmentClaims',
        'cancelledStudyInstances',
        'scrubbedStudyInstances',
        'releasedStudyClaims',
        'erasureFailures',
      ]) {
        expect(details).toHaveProperty(key);
        expect(typeof details[key]).toBe('number');
      }
      // A clean erasure raises no alert — the negative half of the pair.
      expect((await db.collection('adminAlerts').where('type', '==', 'partial_user_erasure').get()).size)
        .toBe(0);
    });
  });

  describe('a supervised minor deletes their own account', () => {
    it('erases the child AND tells every guardian — the ordering invariant', async () => {
      const child = await createSupervisedChild();
      const db = getDb();

      const token = await signInWithPassword(child.email, PASSWORD);
      await callFunction('deleteMyAccount', { confirm: 'DELETE' }, token);

      // Gone, verified by reading back rather than by trusting the callable.
      expect((await db.collection('users').doc(child.uid).get()).exists).toBe(false);
      expect((await db.collection('guardianLinks').doc(child.uid).get()).exists).toBe(false);
      await expect(getAdminAuth().getUser(child.uid)).rejects.toMatchObject({
        code: 'auth/user-not-found',
      });

      // THE pin this design exists for. `eraseUserAccount` deletes
      // guardianLinks/{uid}; the supervising family therefore has to come back
      // OUT of the erasure. If anyone ever "simplifies" that into a read placed
      // after the erasure, it returns nothing, the guardian is never told, and
      // no error is raised — this assertion is the only thing that would notice.
      const notices = await guardianNotices();
      expect(notices).toHaveLength(2); // family1 has two parents
      expect(notices.map((d) => d.data().recipientUserId).sort()).toEqual(
        [seed.parent1.uid, seed.parent2.uid].sort(),
      );
      const notice = notices[0].data();
      expect(notice.read).toBe(false);
      expect(notice.channels).toEqual(['email', 'push']);
      expect(notice.emailSent).toBe(true);
      // No FCM registration in the emulator, so the honest answer is false —
      // and the reached-count below must therefore be carried by email alone.
      expect(notice.pushSent).toBe(false);
      // The doc outlives the account, and the two fields answer differently on
      // purpose: the guardian-readable copy names the child (they supervise
      // more than one, and this is the only channel that persists when both
      // transports miss), while the structured payload carries the uid alone.
      // The email — an identifier no guardian needs here — is in neither.
      expect(notice.body).toContain('Zoe Dupont');
      expect(notice.data).toEqual({ childUid: child.uid });
      expect(JSON.stringify(notice.data)).not.toContain(child.email);
      expect(notice.body).not.toContain(child.email);

      const details = (await auditEntry(child.uid))!.details as Record<string, unknown>;
      expect(details.wasSupervised).toBe(true);
      expect(details.guardiansFound).toBe(2);
      expect(details.guardiansReached).toBe(2);
    });

    it('counts every guardian the family NAMES, including one with no user doc', async () => {
      // Scope note: this pins `guardiansFound` end-to-end. The other half —
      // that `guardiansReached` counts DELIVERIES rather than iterations — is
      // not stageable here: the emulator's mail transport returns true for any
      // address, and every production writer of a `users` doc sets `email`, so
      // a both-channels-missed guardian would need a fabricated document
      // shape. It is pinned in
      // packages/shared-functions/src/account/__tests__/guardianNotifyCounts.test.ts,
      // where the transport results are inputs.
      const child = await createSupervisedChild();
      const db = getDb();

      // A parentIds entry with no user doc: the branch `notifyGuardiansOfSelfDelete`
      // already guards with `if (!parentData) continue`. Nothing is fabricated —
      // the fixture is an ABSENCE, and the family doc keeps the shape its own
      // writers give it.
      await db
        .collection('families')
        .doc(seed.family1Id)
        .update({ parentIds: [seed.parent1.uid, seed.parent2.uid, 'no-such-parent'] });

      const token = await signInWithPassword(child.email, PASSWORD);
      await callFunction('deleteMyAccount', { confirm: 'DELETE' }, token);

      // Three guardians named, two reached. A count that only tallied parents
      // whose doc existed would report 2 here and lose the guardian nobody
      // could tell.
      const details = (await auditEntry(child.uid))!.details as Record<string, unknown>;
      expect(details.guardiansFound).toBe(3);
      expect(details.guardiansReached).toBe(2);
      expect(await guardianNotices()).toHaveLength(2);
    });
  });

  describe('the re-auth window cannot be refreshed by switching apps', () => {
    /**
     * `redeemAppHandoffCode` mints a custom token, and signing in with it
     * stamps a brand-new `auth_time` — so before `originalAuthTime` rode
     * along, a month-old borrowed session could tap the app-switch bar and
     * come back inside the 15-minute window.
     *
     * The minting session here is genuinely fresh (the emulator has no way to
     * age a real sign-in), so the test ages the ONE value that carries the
     * credential's age — the `originAuthTime` field `createAppHandoffCode`
     * itself writes on the code doc.
     */
    async function handoffSession(uid: string, ageSeconds: number | null): Promise<string> {
      const minted = await callFunction<{ code: string }>(
        'createAppHandoffCode',
        {},
        await getIdToken(uid),
      );
      const codes = await getDb().collection('appHandoffCodes').get();
      expect(codes.size).toBe(1);
      if (ageSeconds !== null) {
        await codes.docs[0].ref.update({
          originAuthTime: Math.floor(Date.now() / 1000) - ageSeconds,
        });
      }
      const { token } = await callFunction<{ token: string }>('redeemAppHandoffCode', {
        code: minted.code,
      });
      return exchangeCustomToken(token);
    }

    it('the handoff records the originating session credential age', async () => {
      await callFunction<{ code: string }>(
        'createAppHandoffCode',
        {},
        await getIdToken(seed.babysitter2.uid),
      );
      const doc = (await getDb().collection('appHandoffCodes').get()).docs[0].data();
      expect(typeof doc.originAuthTime).toBe('number');
      expect(doc.originAuthTime).toBeGreaterThan(0);
    });

    it('refuses a delete from a handoff session whose credential is old', async () => {
      const idToken = await handoffSession(seed.babysitter2.uid, 30 * 24 * 60 * 60);

      // The bypass in one line: the handoff sign-in IS fresh...
      const claims = claimsOf(idToken);
      expect(Number(claims.auth_time) * 1000).toBeGreaterThan(Date.now() - 60_000);
      // ...and the carried claim is what makes the guard see through it.
      expect(Number(claims.originalAuthTime) * 1000).toBeLessThan(Date.now() - 29 * 86_400_000);

      await expect(
        callFunction('deleteMyAccount', { confirm: 'DELETE' }, idToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
      expect((await getDb().collection('users').doc(seed.babysitter2.uid).get()).exists).toBe(true);
    });

    it('still allows a delete from a handoff whose originating session was fresh', async () => {
      // The positive control: the guard must reject stale credentials, not all
      // handoff sessions. Without this, "reject everything" would pass above.
      const idToken = await handoffSession(seed.babysitter2.uid, null);
      const result = await callFunction<{ success: boolean }>(
        'deleteMyAccount',
        { confirm: 'DELETE' },
        idToken,
      );
      expect(result.success).toBe(true);
      expect((await getDb().collection('users').doc(seed.babysitter2.uid).get()).exists).toBe(
        false,
      );
    });

    it('a real password sign-in drops the carried claim — the escape hatch works', async () => {
      // The whole rule depends on a member locked out by an inherited
      // credential age having a way back in. `effectiveAuthTime.ts` claims a
      // real re-authentication clears `originalAuthTime`; this stages it
      // rather than assuming it.
      //
      // The API under test is `accounts:signInWithPassword`, deliberately:
      // that is the endpoint the JS SDK's `reauthenticateWithCredential` hits
      // for an email/password credential, and it swaps the resulting tokens
      // onto the current user. So this settles BOTH routes at once — a full
      // sign-out + sign-in, and a "please confirm your password" modal on the
      // existing custom-token session.
      const child = await createSupervisedChild();
      const handoffToken = await handoffSession(child.uid, 30 * 24 * 60 * 60);
      await expect(
        callFunction('deleteMyAccount', { confirm: 'DELETE' }, handoffToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

      const reauthed = await signInWithPassword(child.email, PASSWORD);
      // The developer claim does not survive the credential sign-in...
      expect(claimsOf(reauthed).originalAuthTime).toBeUndefined();
      // ...so the guard sees a fresh credential and the member is unblocked.
      const result = await callFunction<{ success: boolean }>(
        'deleteMyAccount',
        { confirm: 'DELETE' },
        reauthed,
      );
      expect(result.success).toBe(true);
      expect((await getDb().collection('users').doc(child.uid).get()).exists).toBe(false);
    });
  });
});
