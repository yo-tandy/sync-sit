import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Admin governance surfaces: the supervised-accounts GDPR view, the alert
// queue, and force-revocation (paired with minor deactivation under 15).

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

describe('guardian admin surfaces', () => {
  let seed: SeedData;
  let adminToken: string;
  let parent1Token: string;
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parent1Token = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  async function seedKid(uid: string, age: number, governed = true) {
    counter += 1;
    await getDb().collection('users').doc(uid).set({
      uid,
      email: `admin.kid${counter}@ejm.org`,
      status: 'active',
      firstName: `AdminKid${counter}`,
      lastName: 'Test',
      dateOfBirth: new Date(dobWithAge(age)),
      language: 'en',
      profiles: {},
      notifPrefs: {},
      fcmTokens: [],
      ...(governed ? { governedBy: { familyId: seed.family1Id, linkedAt: new Date() } } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function seedLink(childUid: string, status: 'pending' | 'active' | 'revoked') {
    await getDb().collection('guardianLinks').doc(childUid).set({
      childUid,
      familyId: seed.family1Id,
      createdByParentUid: seed.parent1.uid,
      status,
      origin: 'parent_created',
      requestedAt: new Date(),
      ...(status === 'active' ? { confirmedAt: new Date() } : {}),
      ...(status === 'revoked' ? { revokedAt: new Date() } : {}),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
    });
  }

  it('all four surfaces are admin-only', async () => {
    for (const [name, data] of [
      ['listSupervisedAccounts', {}],
      ['listAdminAlerts', {}],
      ['reviewAdminAlert', { alertId: 'x' }],
      ['forceRevokeSupervision', { childUid: 'x', reason: 'A good reason' }],
    ] as const) {
      await expect(callFunction(name, data, parent1Token)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      await expect(callFunction(name, data)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }
  });

  it('listSupervisedAccounts is the GDPR audit view: every link with its consent record', async () => {
    await seedKid('laKid1', 13);
    await seedLink('laKid1', 'active');
    await seedKid('laKid2', 16, false);
    await seedLink('laKid2', 'revoked');

    const result = await callFunction<{ accounts: Array<Record<string, any>> }>(
      'listSupervisedAccounts',
      {},
      adminToken,
    );
    const byUid = Object.fromEntries(result.accounts.map((a) => [a.childUid, a]));
    expect(byUid.laKid1).toBeTruthy();
    expect(byUid.laKid2).toBeTruthy(); // any status — revoked links stay auditable

    expect(byUid.laKid1.link.status).toBe('active');
    expect(byUid.laKid1.child.firstName).toMatch(/^AdminKid/);
    expect(byUid.laKid1.familyName).toBe('Dupont');
    // The consent record — this IS the GDPR view.
    expect(byUid.laKid1.consent).toMatchObject({
      tosVersion: '1.0',
      privacyVersion: '1.0',
      supervisionAgreementVersion: '1.0',
      approvedByUid: seed.parent1.uid,
    });
    expect(byUid.laKid1.consent.approvedAt).toBeTruthy();
  });

  it('listAdminAlerts filters unreviewed and reviewAdminAlert stamps', async () => {
    const alertRef = await getDb().collection('adminAlerts').add({
      type: 'guardian_conflicting_claim',
      createdAt: new Date(),
      data: { attemptedByUid: seed.parent3.uid, familyId: seed.family2Id },
    });
    const reviewedRef = await getDb().collection('adminAlerts').add({
      type: 'guardian_claim_identity_mismatch',
      createdAt: new Date(),
      data: {},
      reviewedAt: new Date(),
      reviewedByUid: seed.admin.uid,
    });

    const all = await callFunction<{ alerts: Array<Record<string, any>> }>(
      'listAdminAlerts',
      {},
      adminToken,
    );
    const allIds = all.alerts.map((a) => a.alertId);
    expect(allIds).toContain(alertRef.id);
    expect(allIds).toContain(reviewedRef.id);

    const unreviewed = await callFunction<{ alerts: Array<Record<string, any>> }>(
      'listAdminAlerts',
      { onlyUnreviewed: true },
      adminToken,
    );
    const unreviewedIds = unreviewed.alerts.map((a) => a.alertId);
    expect(unreviewedIds).toContain(alertRef.id);
    expect(unreviewedIds).not.toContain(reviewedRef.id);

    const result = await callFunction('reviewAdminAlert', { alertId: alertRef.id }, adminToken);
    expect(result).toEqual({ success: true });
    const stamped = (await alertRef.get()).data()!;
    expect(stamped.reviewedByUid).toBe(seed.admin.uid);
    expect(stamped.reviewedAt).toBeTruthy();
  });

  it('force-revoke of an under-15 pairs with account deactivation and an alert', async () => {
    await getAdminAuth().createUser({ uid: 'frKid1', email: 'frkid1@ejm.org', password: 'Test1234' });
    await seedKid('frKid1', 13);
    await seedLink('frKid1', 'active');

    const result = await callFunction(
      'forceRevokeSupervision',
      { childUid: 'frKid1', reason: 'Custody dispute resolution' },
      adminToken,
    );
    expect(result).toEqual({ success: true });

    const link = (await getDb().collection('guardianLinks').doc('frKid1').get()).data()!;
    expect(link.status).toBe('revoked');
    expect(link.revokedByUid).toBe(seed.admin.uid);

    // The minor cannot keep a live unsupervised account.
    const kid = (await getDb().collection('users').doc('frKid1').get()).data()!;
    expect(kid.governedBy).toBeUndefined();
    expect(kid.status).toBe('blocked');
    const authUser = await getAdminAuth().getUser('frKid1');
    expect(authUser.disabled).toBe(true);

    const alerts = await getDb()
      .collection('adminAlerts')
      .where('type', '==', 'guardian_forced_revoke_minor')
      .get();
    expect(alerts.docs.some((d) => d.data().data.childUid === 'frKid1')).toBe(true);

    // Audit carries the reason.
    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'guardian.force_revoke_supervision')
      .get();
    const entry = audits.docs.map((d) => d.data()).find((a) => a.targetUserId === 'frKid1')!;
    expect(entry.details.reason).toBe('Custody dispute resolution');
  });

  it('force-revoke of a 15+ child is a plain revoke (account untouched)', async () => {
    await getAdminAuth().createUser({ uid: 'frKid2', email: 'frkid2@ejm.org', password: 'Test1234' });
    await seedKid('frKid2', 16);
    await seedLink('frKid2', 'active');

    const result = await callFunction(
      'forceRevokeSupervision',
      { childUid: 'frKid2', reason: 'Parental request escalation' },
      adminToken,
    );
    expect(result).toEqual({ success: true });

    const kid = (await getDb().collection('users').doc('frKid2').get()).data()!;
    expect(kid.governedBy).toBeUndefined();
    expect(kid.status).toBe('active');
    const authUser = await getAdminAuth().getUser('frKid2');
    expect(authUser.disabled).toBe(false);

    // Family and kid were told.
    const kidNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', 'frKid2')
      .get();
    expect(kidNotifs.docs.some((d) => d.data().type === 'supervision_revoked')).toBe(true);
    const parentNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid)
      .get();
    expect(parentNotifs.docs.some((d) => d.data().type === 'supervision_revoked')).toBe(true);
  });

  it('force-revoke requires an ACTIVE link and a reason', async () => {
    await seedKid('frKid3', 13, false);
    await seedLink('frKid3', 'revoked');
    await expect(
      callFunction(
        'forceRevokeSupervision',
        { childUid: 'frKid3', reason: 'No active link here' },
        adminToken,
      ),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    await expect(
      callFunction('forceRevokeSupervision', { childUid: 'frKid3' }, adminToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
