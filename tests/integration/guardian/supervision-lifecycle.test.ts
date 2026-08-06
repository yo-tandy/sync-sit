import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// respondToSupervisionRequest / revokeSupervision / correctChildIdentity.
// Invariant asserted throughout: the governedBy mirror is present iff the
// guardianLinks doc is ACTIVE.

function schoolYearEnd(): number {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}
const GRAD = (schoolYearEnd() + 3) % 100;

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

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

describe('supervision lifecycle', () => {
  let seed: SeedData;
  let parent1Token: string; // family1
  let parent3Token: string; // family2
  let adminToken: string;
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  /** Seed a kid user doc (and auth-less uid) with the given age. */
  async function seedKid(
    uid: string,
    opts: { age?: number; identityLocked?: boolean; governedBy?: string | null } = {},
  ) {
    counter += 1;
    const email = `lifecycle.kid${counter}g${GRAD}@ejm.org`;
    const docData: Record<string, unknown> = {
      uid,
      email,
      status: 'active',
      firstName: 'Kid',
      lastName: 'Lifecycle',
      dateOfBirth: new Date(dobWithAge(opts.age ?? 13)),
      language: 'en',
      profiles: {},
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (opts.identityLocked) docData.identityLocked = true;
    if (opts.governedBy) docData.governedBy = { familyId: opts.governedBy, linkedAt: new Date() };
    await getDb().collection('users').doc(uid).set(docData);
    return email;
  }

  async function seedLink(
    childUid: string,
    familyId: string,
    status: 'pending' | 'active' | 'revoked',
    origin: 'claim' | 'parent_created' = 'claim',
  ) {
    const link: Record<string, unknown> = {
      childUid,
      familyId,
      createdByParentUid: seed.parent1.uid,
      status,
      origin,
      requestedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
    };
    if (status === 'active') link.confirmedAt = new Date();
    if (status === 'revoked') link.revokedAt = new Date();
    await getDb().collection('guardianLinks').doc(childUid).set(link);
  }

  // ── respondToSupervisionRequest ──

  describe('respondToSupervisionRequest', () => {
    it('accept activates the link and sets the governedBy mirror', async () => {
      await seedKid('rsKid1');
      await seedLink('rsKid1', seed.family1Id, 'pending');
      const token = await getIdToken('rsKid1');

      const result = await callFunction('respondToSupervisionRequest', { accept: true }, token);
      expect(result).toEqual({ success: true });

      const link = (await getDb().collection('guardianLinks').doc('rsKid1').get()).data()!;
      expect(link.status).toBe('active');
      expect(link.confirmedAt).toBeTruthy();

      // Mirror present ⇔ link ACTIVE.
      const kid = (await getDb().collection('users').doc('rsKid1').get()).data()!;
      expect(kid.governedBy).toEqual({ familyId: seed.family1Id, linkedAt: expect.anything() });
      // Claim path never locks identity.
      expect(kid.identityLocked).toBeUndefined();

      // The supervising family's parents were notified.
      const notifs = await getDb()
        .collection('notifications')
        .where('type', '==', 'supervision_confirmed')
        .get();
      const recipients = notifs.docs.map((d) => d.data().recipientUserId);
      expect(recipients).toContain(seed.parent1.uid);
      expect(recipients).toContain(seed.parent2.uid);
    });

    it('decline DELETES the link (a later re-ask stays possible) and sets no mirror', async () => {
      await seedKid('rsKid2');
      await seedLink('rsKid2', seed.family1Id, 'pending');
      const token = await getIdToken('rsKid2');

      const result = await callFunction('respondToSupervisionRequest', { accept: false }, token);
      expect(result).toEqual({ success: true });

      const link = await getDb().collection('guardianLinks').doc('rsKid2').get();
      expect(link.exists).toBe(false);
      const kid = (await getDb().collection('users').doc('rsKid2').get()).data()!;
      expect(kid.governedBy).toBeUndefined();
    });

    it('fails when there is no pending request', async () => {
      await seedKid('rsKid3');
      const token = await getIdToken('rsKid3');
      await expect(
        callFunction('respondToSupervisionRequest', { accept: true }, token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'guardian/no-pending-request' },
      });
    });

    it('cannot respond to an already-active link', async () => {
      await seedKid('rsKid4', { governedBy: 'family-dupont' });
      await seedLink('rsKid4', seed.family1Id, 'active');
      const token = await getIdToken('rsKid4');
      await expect(
        callFunction('respondToSupervisionRequest', { accept: true }, token),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });

    it('a pending parent_created link is NOT respondable (redeem is its only activation)', async () => {
      await seedKid('rsKid5');
      await seedLink('rsKid5', seed.family1Id, 'pending', 'parent_created');
      const token = await getIdToken('rsKid5');
      await expect(
        callFunction('respondToSupervisionRequest', { accept: true }, token),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
      // And it was not deleted either.
      expect((await getDb().collection('guardianLinks').doc('rsKid5').get()).exists).toBe(true);
    });

    it('requires authentication', async () => {
      await expect(
        callFunction('respondToSupervisionRequest', { accept: true }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  // ── revokeSupervision ──

  describe('revokeSupervision', () => {
    it('a family parent revokes supervision of a 16-year-old', async () => {
      await seedKid('rvKid1', { age: 16, identityLocked: true, governedBy: 'family-dupont' });
      await seedLink('rvKid1', seed.family1Id, 'active', 'parent_created');

      const result = await callFunction(
        'revokeSupervision',
        { childUid: 'rvKid1' },
        parent1Token,
      );
      expect(result).toEqual({ success: true });

      const link = (await getDb().collection('guardianLinks').doc('rvKid1').get()).data()!;
      expect(link.status).toBe('revoked');
      expect(link.revokedAt).toBeTruthy();
      expect(link.revokedByUid).toBe(seed.parent1.uid);

      const kid = (await getDb().collection('users').doc('rvKid1').get()).data()!;
      // Mirror removed with the ACTIVE status …
      expect(kid.governedBy).toBeUndefined();
      // … but the identity stays parent-attested.
      expect(kid.identityLocked).toBe(true);

      // Kid was told.
      const notifs = await getDb()
        .collection('notifications')
        .where('recipientUserId', '==', 'rvKid1')
        .get();
      expect(notifs.docs.some((d) => d.data().type === 'supervision_revoked')).toBe(true);
    });

    it('refuses to revoke for an under-15 child — including for admin', async () => {
      await seedKid('rvKid2', { age: 13, governedBy: 'family-dupont' });
      await seedLink('rvKid2', seed.family1Id, 'active');

      await expect(
        callFunction('revokeSupervision', { childUid: 'rvKid2' }, parent1Token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'guardian/child-under-15' },
      });
      // Admin force-revoke for under-15s pairs with account deactivation —
      // that is guardian-controls (PR 3) scope, so admin gets the same refusal.
      await expect(
        callFunction('revokeSupervision', { childUid: 'rvKid2' }, adminToken),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'guardian/child-under-15' },
      });

      // Nothing changed.
      const link = (await getDb().collection('guardianLinks').doc('rvKid2').get()).data()!;
      expect(link.status).toBe('active');
      const kid = (await getDb().collection('users').doc('rvKid2').get()).data()!;
      expect(kid.governedBy).toBeTruthy();
    });

    it('admin CAN revoke for a 15+ child', async () => {
      await seedKid('rvKid3', { age: 15, governedBy: 'family-dupont' });
      await seedLink('rvKid3', seed.family1Id, 'active');

      const result = await callFunction('revokeSupervision', { childUid: 'rvKid3' }, adminToken);
      expect(result).toEqual({ success: true });
      const link = (await getDb().collection('guardianLinks').doc('rvKid3').get()).data()!;
      expect(link.status).toBe('revoked');
      expect(link.revokedByUid).toBe(seed.admin.uid);
    });

    it('a parent of ANOTHER family cannot revoke (indistinguishable from not-supervised)', async () => {
      await seedKid('rvKid4', { age: 16, governedBy: 'family-dupont' });
      await seedLink('rvKid4', seed.family1Id, 'active');

      await expect(
        callFunction('revokeSupervision', { childUid: 'rvKid4' }, parent3Token),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
      const link = (await getDb().collection('guardianLinks').doc('rvKid4').get()).data()!;
      expect(link.status).toBe('active');
    });

    it('the kid cannot self-revoke', async () => {
      await seedKid('rvKid5', { age: 16, governedBy: 'family-dupont' });
      await seedLink('rvKid5', seed.family1Id, 'active');
      const token = await getIdToken('rvKid5');
      await expect(
        callFunction('revokeSupervision', { childUid: 'rvKid5' }, token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('fails when there is no active link', async () => {
      await seedKid('rvKid6', { age: 16 });
      await expect(
        callFunction('revokeSupervision', { childUid: 'rvKid6' }, parent1Token),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });
  });

  // ── correctChildIdentity ──

  describe('correctChildIdentity', () => {
    it('a supervising parent corrects name and DOB on a locked account', async () => {
      await seedKid('ciKid1', { age: 13, identityLocked: true, governedBy: 'family-dupont' });
      await seedLink('ciKid1', seed.family1Id, 'active', 'parent_created');

      const result = await callFunction(
        'correctChildIdentity',
        { childUid: 'ciKid1', firstName: 'Chloe', dateOfBirth: dobWithAge(12) },
        parent1Token,
      );
      expect(result).toEqual({ success: true });

      const kid = (await getDb().collection('users').doc('ciKid1').get()).data()!;
      expect(kid.firstName).toBe('Chloe');
      expect(kid.lastName).toBe('Lifecycle'); // untouched
      expect(kid.dateOfBirth.toDate().toISOString().slice(0, 10)).toBe(dobWithAge(12));
      expect(kid.identityLocked).toBe(true);

      // Audit carries before/after.
      const audits = await getDb()
        .collection('auditLogs')
        .where('action', '==', 'guardian.correct_child_identity')
        .get();
      const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === 'ciKid1');
      expect(mine.length).toBe(1);
      expect(mine[0].details.before.firstName).toBe('Kid');
      expect(mine[0].details.after.firstName).toBe('Chloe');
    });

    it('requires at least one correctable field', async () => {
      await seedKid('ciKid2', { identityLocked: true, governedBy: 'family-dupont' });
      await seedLink('ciKid2', seed.family1Id, 'active', 'parent_created');
      await expect(
        callFunction('correctChildIdentity', { childUid: 'ciKid2' }, parent1Token),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('rejects an unlocked target (claim-origin accounts keep self-service identity)', async () => {
      await seedKid('ciKid3', { governedBy: 'family-dupont' });
      await seedLink('ciKid3', seed.family1Id, 'active');
      await expect(
        callFunction(
          'correctChildIdentity',
          { childUid: 'ciKid3', firstName: 'X' },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });

    it('the kid cannot call it on themselves', async () => {
      await seedKid('ciKid4', { identityLocked: true, governedBy: 'family-dupont' });
      await seedLink('ciKid4', seed.family1Id, 'active', 'parent_created');
      const token = await getIdToken('ciKid4');
      await expect(
        callFunction('correctChildIdentity', { childUid: 'ciKid4', firstName: 'Me' }, token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('a parent without the active link is refused', async () => {
      await seedKid('ciKid5', { identityLocked: true, governedBy: 'family-dupont' });
      await seedLink('ciKid5', seed.family1Id, 'active', 'parent_created');
      await expect(
        callFunction(
          'correctChildIdentity',
          { childUid: 'ciKid5', firstName: 'X' },
          parent3Token,
        ),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });

    it('after revocation the parent is refused but admin still corrects', async () => {
      await seedKid('ciKid6', { age: 16, identityLocked: true });
      await seedLink('ciKid6', seed.family1Id, 'revoked', 'parent_created');

      await expect(
        callFunction(
          'correctChildIdentity',
          { childUid: 'ciKid6', firstName: 'X' },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

      const result = await callFunction(
        'correctChildIdentity',
        { childUid: 'ciKid6', firstName: 'AdminFixed' },
        adminToken,
      );
      expect(result).toEqual({ success: true });
      const kid = (await getDb().collection('users').doc('ciKid6').get()).data()!;
      expect(kid.firstName).toBe('AdminFixed');
    });

    it('a DOB correction feeds the revoke age gate end-to-end', async () => {
      await seedKid('ciKid7', { age: 13, identityLocked: true, governedBy: 'family-dupont' });
      await seedLink('ciKid7', seed.family1Id, 'active', 'parent_created');

      // Under 15 → revoke refused.
      await expect(
        callFunction('revokeSupervision', { childUid: 'ciKid7' }, parent1Token),
      ).rejects.toMatchObject({ details: { code: 'guardian/child-under-15' } });

      // Parent corrects the DOB (the kid is actually 16)…
      await callFunction(
        'correctChildIdentity',
        { childUid: 'ciKid7', dateOfBirth: dobWithAge(16) },
        parent1Token,
      );

      // …and the revoke gate now passes.
      const result = await callFunction(
        'revokeSupervision',
        { childUid: 'ciKid7' },
        parent1Token,
      );
      expect(result).toEqual({ success: true });
    });

    it('rejects a malformed dateOfBirth', async () => {
      await seedKid('ciKid8', { identityLocked: true, governedBy: 'family-dupont' });
      await seedLink('ciKid8', seed.family1Id, 'active', 'parent_created');
      await expect(
        callFunction(
          'correctChildIdentity',
          { childUid: 'ciKid8', dateOfBirth: 'not-a-date' },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
