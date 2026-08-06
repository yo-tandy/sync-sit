import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// GDPR integration: guardian links + kid invites in deleteUser / exportUserData.

function schoolYearEnd(): number {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}
const GRAD = (schoolYearEnd() + 3) % 100;

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

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

describe('guardian GDPR integration', () => {
  let seed: SeedData;
  let adminToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  let counter = 0;
  /** Governed child with a real auth user, active link, and (optionally) invites. */
  async function seedGovernedChild(
    familyId: string,
    parentUid: string,
    opts: { age: number; withInvite?: boolean },
  ): Promise<{ uid: string; email: string }> {
    counter += 1;
    const email = `gdpr.kid${counter}g${GRAD}@ejm.org`;
    const authUser = await getAdminAuth().createUser({ email, password: 'Str0ngPass1' });
    const uid = authUser.uid;
    await getDb().collection('users').doc(uid).set({
      uid,
      email,
      status: 'active',
      firstName: `Kid${counter}`,
      lastName: 'Gdpr',
      dateOfBirth: new Date(dobWithAge(opts.age)),
      language: 'en',
      profiles: {},
      notifPrefs: {},
      fcmTokens: [],
      identityLocked: true,
      governedBy: { familyId, linkedAt: new Date() },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await getDb().collection('guardianLinks').doc(uid).set({
      childUid: uid,
      familyId,
      createdByParentUid: parentUid,
      status: 'active',
      origin: 'parent_created',
      requestedAt: new Date(),
      confirmedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: parentUid },
    });
    if (opts.withInvite) {
      await getDb().collection('kidInvites').add({
        kidEmailLower: email,
        firstName: `Kid${counter}`,
        lastName: 'Gdpr',
        dateOfBirth: dobWithAge(opts.age),
        familyId,
        createdByParentUid: parentUid,
        tokenHash: 'a'.repeat(64),
        status: 'accepted',
        createdAt: new Date(),
        expiresAt: new Date(),
        consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: parentUid },
      });
    }
    return { uid, email };
  }

  it('deleting a CHILD removes their guardian link and their kid invites', async () => {
    const child = await seedGovernedChild(seed.family1Id, seed.parent1.uid, {
      age: 13,
      withInvite: true,
    });

    const result = await callFunction<{ success: boolean }>(
      'deleteUser',
      { targetUserId: child.uid },
      adminToken,
    );
    expect(result.success).toBe(true);

    expect((await getDb().collection('users').doc(child.uid).get()).exists).toBe(false);
    expect((await getDb().collection('guardianLinks').doc(child.uid).get()).exists).toBe(false);
    const invites = await getDb()
      .collection('kidInvites')
      .where('kidEmailLower', '==', child.email)
      .get();
    expect(invites.size).toBe(0);
  });

  it('deleting a CO-PARENT leaves the family supervision untouched (but anonymizes their invites)', async () => {
    const child = await seedGovernedChild(seed.family1Id, seed.parent2.uid, {
      age: 13,
      withInvite: true,
    });

    await callFunction('deleteUser', { targetUserId: seed.parent2.uid }, adminToken);

    // The co-parent (parent1) still supervises: link untouched, mirror intact.
    const link = (await getDb().collection('guardianLinks').doc(child.uid).get()).data()!;
    expect(link.status).toBe('active');
    const kid = (await getDb().collection('users').doc(child.uid).get()).data()!;
    expect(kid.governedBy).toBeTruthy();
    expect(kid.status).toBe('active');

    // No orphaned-minor alert.
    const alerts = await getDb()
      .collection('adminAlerts')
      .where('type', '==', 'guardian_orphaned_minor')
      .get();
    expect(alerts.size).toBe(0);

    // The deleted parent's uid no longer lingers on invites (GDPR).
    const invites = await getDb()
      .collection('kidInvites')
      .where('kidEmailLower', '==', child.email)
      .get();
    expect(invites.size).toBe(1);
    expect(invites.docs[0].data().createdByParentUid).toBe('deleted');
  });

  it('deleting the LAST parent: under-15 child blocked + alerted, 15+ child just unsupervised', async () => {
    // family2 has a single parent (parent3).
    const young = await seedGovernedChild(seed.family2Id, seed.parent3.uid, { age: 13 });
    const older = await seedGovernedChild(seed.family2Id, seed.parent3.uid, { age: 16 });
    // A still-pending invite from that family.
    const pendingInvite = await getDb().collection('kidInvites').add({
      kidEmailLower: `gdpr.pending${GRAD}@ejm.org`,
      firstName: 'Pending',
      lastName: 'Kid',
      dateOfBirth: dobWithAge(12),
      familyId: seed.family2Id,
      createdByParentUid: seed.parent3.uid,
      tokenHash: 'b'.repeat(64),
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent3.uid },
    });

    await callFunction('deleteUser', { targetUserId: seed.parent3.uid }, adminToken);

    // Both links revoked, both mirrors gone.
    for (const uid of [young.uid, older.uid]) {
      const link = (await getDb().collection('guardianLinks').doc(uid).get()).data()!;
      expect(link.status).toBe('revoked');
      const kid = (await getDb().collection('users').doc(uid).get()).data()!;
      expect(kid.governedBy).toBeUndefined();
    }

    // The under-15 child cannot keep operating unsupervised: hard-blocked
    // (status is the ban gate) with auth disabled, and admin alerted.
    const youngDoc = (await getDb().collection('users').doc(young.uid).get()).data()!;
    expect(youngDoc.status).toBe('blocked');
    const youngAuth = await getAdminAuth().getUser(young.uid);
    expect(youngAuth.disabled).toBe(true);
    const alerts = await getDb()
      .collection('adminAlerts')
      .where('type', '==', 'guardian_orphaned_minor')
      .get();
    const mine = alerts.docs.map((d) => d.data()).filter((a) => a.data?.childUid === young.uid);
    expect(mine.length).toBe(1);

    // The 15+ child keeps a fully functional account.
    const olderDoc = (await getDb().collection('users').doc(older.uid).get()).data()!;
    expect(olderDoc.status).toBe('active');
    const olderAuth = await getAdminAuth().getUser(older.uid);
    expect(olderAuth.disabled).toBe(false);

    // The dead family's pending invite is no longer redeemable.
    const invite = (await pendingInvite.get()).data()!;
    expect(invite.status).toBe('cancelled');
  });

  it('exporting a CHILD includes their guardian link and invites', async () => {
    const child = await seedGovernedChild(seed.family1Id, seed.parent1.uid, {
      age: 13,
      withInvite: true,
    });

    const result = await callFunction<{
      guardianLinks: Array<{ childUid: string }>;
      kidInvites: Array<{ kidEmailLower: string }>;
    }>('exportUserData', { targetUserId: child.uid }, adminToken);

    expect(result.guardianLinks.some((l) => l.childUid === child.uid)).toBe(true);
    expect(result.kidInvites.some((i) => i.kidEmailLower === child.email)).toBe(true);
  });

  it('exporting a PARENT includes the family links and the invites they created', async () => {
    const child = await seedGovernedChild(seed.family1Id, seed.parent1.uid, {
      age: 13,
      withInvite: true,
    });

    const result = await callFunction<{
      guardianLinks: Array<{ childUid: string; familyId: string }>;
      kidInvites: Array<{ kidEmailLower: string; createdByParentUid: string }>;
    }>('exportUserData', { targetUserId: seed.parent1.uid }, adminToken);

    expect(result.guardianLinks.some((l) => l.childUid === child.uid)).toBe(true);
    expect(
      result.kidInvites.some(
        (i) => i.kidEmailLower === child.email && i.createdByParentUid === seed.parent1.uid,
      ),
    ).toBe(true);
  });
});
