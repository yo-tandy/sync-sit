import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Admin-only correction of set-once root identity (issue #158): the rules
// freeze populated firstName/lastName/dateOfBirth against ALL client writes
// (issue #144), and correctChildIdentity only serves identityLocked accounts
// — this callable is the audited escape hatch for everyone else.

describe('correctUserIdentity', () => {
  let seed: SeedData;
  let adminToken: string;
  let parentToken: string;
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parentToken = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  /** Seed a self-managed user doc with a populated root identity. */
  async function seedUser(uid: string, extra: Record<string, unknown> = {}) {
    counter += 1;
    const doc: Record<string, unknown> = {
      uid,
      email: `correct.id${counter}@ejm.org`,
      status: 'active',
      firstName: 'Typoed',
      lastName: 'Name',
      dateOfBirth: new Date('2010-04-01'),
      language: 'en',
      // effectiveSearchable set explicitly (issue #435 PR2) rather than left
      // for onUserWrittenRecomputeSearchable to backfill asynchronously: the
      // "partial update" test below reads this doc back and asserts on the
      // FULL profiles map right after a correctUserIdentity call, which
      // does not itself touch profiles.babysitter — racing the seed
      // write's own trigger convergence made that assertion flaky.
      profiles: { babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true } },
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    };
    await getDb().collection('users').doc(uid).set(doc);
    return doc;
  }

  describe('happy paths', () => {
    it('corrects all three fields and audits before/after', async () => {
      await seedUser('cuiUser1');

      const result = await callFunction(
        'correctUserIdentity',
        {
          targetUserId: 'cuiUser1',
          firstName: 'Fixed',
          lastName: 'Right',
          dateOfBirth: '2010-04-02',
        },
        adminToken,
      );
      expect(result).toEqual({ success: true });

      const user = (await getDb().collection('users').doc('cuiUser1').get()).data()!;
      expect(user.firstName).toBe('Fixed');
      expect(user.lastName).toBe('Right');
      expect(user.dateOfBirth.toDate().toISOString().slice(0, 10)).toBe('2010-04-02');

      const audits = await getDb()
        .collection('auditLogs')
        .where('action', '==', 'user_identity_corrected')
        .get();
      const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === 'cuiUser1');
      expect(mine.length).toBe(1);
      expect(mine[0].adminUserId).toBe(seed.admin.uid);
      expect(mine[0].details.before).toEqual({
        firstName: 'Typoed',
        lastName: 'Name',
        dateOfBirth: '2010-04-01',
      });
      expect(mine[0].details.after).toEqual({
        firstName: 'Fixed',
        lastName: 'Right',
        dateOfBirth: '2010-04-02',
      });
    });

    it('a partial update writes ONLY the provided field', async () => {
      const original = await seedUser('cuiUser2');

      await callFunction(
        'correctUserIdentity',
        { targetUserId: 'cuiUser2', firstName: 'OnlyFirst' },
        adminToken,
      );

      const user = (await getDb().collection('users').doc('cuiUser2').get()).data()!;
      expect(user.firstName).toBe('OnlyFirst');
      expect(user.lastName).toBe('Name');
      expect(user.dateOfBirth.toDate().toISOString().slice(0, 10)).toBe('2010-04-01');
      // Nothing outside root identity is touched.
      expect(user.status).toBe('active');
      expect(user.email).toBe(original.email);
      expect(user.profiles).toEqual({
        // effectiveSearchable (issue #435 PR2): onUserWrittenRecomputeSearchable
        // converges this to true for an active/searchable/enrolled babysitter —
        // present here because the correctUserIdentity write above re-triggers it,
        // not because this callable touches the babysitter profile itself.
        babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
      });

      const audits = await getDb()
        .collection('auditLogs')
        .where('action', '==', 'user_identity_corrected')
        .get();
      const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === 'cuiUser2');
      expect(mine[0].details.before).toEqual({ firstName: 'Typoed' });
      expect(mine[0].details.after).toEqual({ firstName: 'OnlyFirst' });
    });

    it('a governed claim-origin kid (governedBy, NO identityLocked) IS correctable', async () => {
      // The exact account shape correctChildIdentity refuses
      // (guardian/not-identity-locked): claim-origin accounts never get
      // identityLocked — see createKidInvite.
      await seedUser('cuiKid1', {
        governedBy: { familyId: seed.parent1.familyId, linkedAt: new Date() },
      });
      await getDb().collection('guardianLinks').doc('cuiKid1').set({
        childUid: 'cuiKid1',
        familyId: seed.parent1.familyId,
        createdByParentUid: seed.parent1.uid,
        status: 'active',
        origin: 'claim',
        requestedAt: new Date(),
        confirmedAt: new Date(),
      });

      // Sanity: the guardian path indeed refuses this account…
      await expect(
        callFunction(
          'correctChildIdentity',
          { childUid: 'cuiKid1', firstName: 'ViaGuardian' },
          parentToken,
        ),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

      // …and the admin path corrects it.
      const result = await callFunction(
        'correctUserIdentity',
        { targetUserId: 'cuiKid1', firstName: 'ViaAdmin' },
        adminToken,
      );
      expect(result).toEqual({ success: true });
      const kid = (await getDb().collection('users').doc('cuiKid1').get()).data()!;
      expect(kid.firstName).toBe('ViaAdmin');
      expect(kid.governedBy.familyId).toBe(seed.parent1.familyId);
    });

    it('audits the before-DOB when it is stored as a raw string (client-side enrollment shape)', async () => {
      // Babysitter/tutor enrollment writes dateOfBirth as a plain
      // 'YYYY-MM-DD' string via the client SDK (StepProfile) — exactly the
      // self-managed accounts this callable exists for.
      await seedUser('cuiUser9', { dateOfBirth: '2008-11-23' });

      await callFunction(
        'correctUserIdentity',
        { targetUserId: 'cuiUser9', dateOfBirth: '2008-11-24' },
        adminToken,
      );

      const user = (await getDb().collection('users').doc('cuiUser9').get()).data()!;
      // The corrected value is normalized to a Timestamp.
      expect(user.dateOfBirth.toDate().toISOString().slice(0, 10)).toBe('2008-11-24');

      const audits = await getDb()
        .collection('auditLogs')
        .where('action', '==', 'user_identity_corrected')
        .get();
      const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === 'cuiUser9');
      expect(mine.length).toBe(1);
      expect(mine[0].details.before).toEqual({ dateOfBirth: '2008-11-23' });
      expect(mine[0].details.after).toEqual({ dateOfBirth: '2008-11-24' });
    });

    it('trims whitespace around names', async () => {
      await seedUser('cuiUser3');
      await callFunction(
        'correctUserIdentity',
        { targetUserId: 'cuiUser3', firstName: '  Trimmed  ' },
        adminToken,
      );
      const user = (await getDb().collection('users').doc('cuiUser3').get()).data()!;
      expect(user.firstName).toBe('Trimmed');
    });
  });

  describe('access control', () => {
    it('rejects unauthenticated callers', async () => {
      await seedUser('cuiUser4');
      await expect(
        callFunction('correctUserIdentity', { targetUserId: 'cuiUser4', firstName: 'X' }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects non-admin (parent) callers', async () => {
      await seedUser('cuiUser5');
      await expect(
        callFunction(
          'correctUserIdentity',
          { targetUserId: 'cuiUser5', firstName: 'X' },
          parentToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('returns not-found for a missing user', async () => {
      await expect(
        callFunction(
          'correctUserIdentity',
          { targetUserId: 'cui-no-such-user', firstName: 'X' },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('validation', () => {
    it('requires at least one identity field', async () => {
      await seedUser('cuiUser6');
      await expect(
        callFunction('correctUserIdentity', { targetUserId: 'cuiUser6' }, adminToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('rejects a missing targetUserId', async () => {
      await expect(
        callFunction('correctUserIdentity', { firstName: 'X' }, adminToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it.each([
      ['empty firstName', { firstName: '' }],
      ['whitespace-only lastName', { lastName: '   ' }],
      ['name over 80 chars', { firstName: 'x'.repeat(81) }],
      ['malformed DOB', { dateOfBirth: '01/04/2010' }],
      ['impossible DOB', { dateOfBirth: '2010-02-30' }],
    ])('rejects %s', async (_label, fields) => {
      await seedUser('cuiUser7');
      await expect(
        callFunction(
          'correctUserIdentity',
          { targetUserId: 'cuiUser7', ...fields },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('rejects unknown fields (never touches anything but root identity)', async () => {
      await seedUser('cuiUser8');
      await expect(
        callFunction(
          'correctUserIdentity',
          { targetUserId: 'cuiUser8', firstName: 'X', status: 'blocked' },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      const user = (await getDb().collection('users').doc('cuiUser8').get()).data()!;
      expect(user.firstName).toBe('Typoed');
      expect(user.status).toBe('active');
    });
  });
});
