import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import {
  seedTestData,
  seedAppointment,
  seedContactSharingRequest,
  type SeedData,
} from '../../setup/seed.js';

// Guardian protective controls on the SIT appointment/contact lifecycle —
// mirror of guardian-study-controls: auth extension only, same machinery
// (H3 ledger restore, existing notification paths), decline/cancel only.

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

const FUTURE_MON = '2027-06-07';

function eveningGrid(): boolean[] {
  const slots = new Array(96).fill(false);
  for (let i = 68; i < 88; i++) slots[i] = true; // 17:00–22:00
  return slots;
}

const GOVERNED = 'gsitSitter'; // supervised by family1
const PENDING_KID = 'gsitPending';
const PLAIN = 'gsitPlain';

describe('guardian protective controls — sit', () => {
  let seed: SeedData;
  let guardianToken: string; // parent1 of family1

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    guardianToken = await getIdToken(seed.parent1.uid);

    const weekly = {
      mon: eveningGrid(), tue: eveningGrid(), wed: eveningGrid(), thu: eveningGrid(),
      fri: eveningGrid(), sat: eveningGrid(), sun: eveningGrid(),
    };
    for (const [uid, link] of [
      [GOVERNED, 'active'],
      [PENDING_KID, 'pending'],
      [PLAIN, null],
    ] as const) {
      await getDb().collection('users').doc(uid).set({
        uid,
        email: `${uid}@ejm.org`,
        status: 'active',
        firstName: 'Gsit',
        lastName: uid,
        dateOfBirth: new Date('2013-02-15'),
        language: 'en',
        profiles: { babysitter: { enrollmentComplete: true, searchable: true } },
        notifPrefs: {},
        fcmTokens: [],
        ...(link === 'active'
          ? { governedBy: { familyId: seed.family1Id, linkedAt: new Date() } }
          : {}),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await getDb().collection('schedules').doc(uid).set({ weekly });
      if (link) {
        await getDb().collection('guardianLinks').doc(uid).set({
          childUid: uid,
          familyId: seed.family1Id,
          createdByParentUid: seed.parent1.uid,
          status: link,
          origin: 'parent_created',
          requestedAt: new Date(),
          ...(link === 'active' ? { confirmedAt: new Date() } : {}),
          consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
        });
      }
    }
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    for (const coll of ['notifications', 'auditLogs']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  });

  /** The 18:00–20:00 claim (slots 72–80) recorded at accept time. */
  async function seedClaimOverride(babysitterUid: string, date: string, appointmentId: string) {
    const slots = eveningGrid();
    for (let i = 72; i < 80; i++) slots[i] = false;
    await getDb()
      .collection('schedules')
      .doc(babysitterUid)
      .collection('overrides')
      .doc(date)
      .set({
        date,
        type: 'custom',
        slots,
        sessionBlocks: [{ appointmentId, startIdx: 72, endIdx: 80 }],
        appSource: 'sit',
        reason: 'appointment',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }

  it('guardian cancels a confirmed appointment and the claimed slots are restored', async () => {
    const appointmentId = await seedAppointment({
      babysitterUserId: GOVERNED,
      familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid,
      status: 'confirmed',
      date: FUTURE_MON,
      startTime: '18:00',
      endTime: '20:00',
    });
    await seedClaimOverride(GOVERNED, FUTURE_MON, appointmentId);

    const result = await callFunction(
      'cancelAppointment',
      { appointmentId, reason: 'Guardian decision' },
      guardianToken,
    );
    expect(result).toMatchObject({ success: true });

    const apt = (await getDb().collection('appointments').doc(appointmentId).get()).data()!;
    expect(apt.status).toBe('cancelled');
    expect(apt.statusReason).toBe('cancelled_by_babysitter');
    expect(apt.cancelledFromStatus).toBe('confirmed');

    // H3 ledger restore: the claim-only override doc is gone.
    const override = await getDb()
      .collection('schedules')
      .doc(GOVERNED)
      .collection('overrides')
      .doc(FUTURE_MON)
      .get();
    expect(override.exists).toBe(false);

    // Family notified via the existing path.
    const famNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', seed.parent3.uid)
      .get();
    expect(famNotifs.docs.some((d) => d.data().type === 'request_cancelled')).toBe(true);

    // Kid told; audit carries the guardian actor.
    const kidNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', GOVERNED)
      .get();
    expect(kidNotifs.docs.some((d) => d.data().type === 'guardian_action')).toBe(true);

    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'cancelled_by_babysitter')
      .get();
    const entry = audits.docs
      .map((d) => d.data())
      .find((a) => a.details?.appointmentId === appointmentId)!;
    expect(entry.adminUserId).toBe(seed.parent1.uid);
    expect(entry.details.actorRole).toBe('guardian');
  });

  it('guardian declines a pending request', async () => {
    const appointmentId = await seedAppointment({
      babysitterUserId: GOVERNED,
      familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid,
      status: 'pending',
      date: FUTURE_MON,
    });

    const result = await callFunction(
      'respondToRequest',
      { appointmentId, action: 'decline' },
      guardianToken,
    );
    expect(result).toMatchObject({ success: true });

    const apt = (await getDb().collection('appointments').doc(appointmentId).get()).data()!;
    expect(apt.status).toBe('rejected');
    expect(apt.statusReason).toBe('declined_by_babysitter');

    const famNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', seed.parent3.uid)
      .get();
    expect(famNotifs.docs.some((d) => d.data().type === 'request_declined')).toBe(true);

    const kidNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', GOVERNED)
      .get();
    expect(kidNotifs.docs.some((d) => d.data().type === 'guardian_action')).toBe(true);

    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'appointment_declined')
      .get();
    const entry = audits.docs
      .map((d) => d.data())
      .find((a) => a.details?.appointmentId === appointmentId)!;
    expect(entry.details.actorRole).toBe('guardian');
  });

  it('guardian can NEVER accept a request (decline-only pin)', async () => {
    const appointmentId = await seedAppointment({
      babysitterUserId: GOVERNED,
      familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid,
      status: 'pending',
      date: FUTURE_MON,
    });

    await expect(
      callFunction('respondToRequest', { appointmentId, action: 'accept' }, guardianToken),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { code: 'guardian/decline-only' },
    });

    const apt = (await getDb().collection('appointments').doc(appointmentId).get()).data()!;
    expect(apt.status).toBe('pending');
  });

  it('guardian declines a contact sharing request', async () => {
    const requestId = await seedContactSharingRequest({
      babysitterUserId: GOVERNED,
      familyId: seed.family2Id,
    });

    const result = await callFunction(
      'respondToContactSharing',
      { requestId, action: 'decline' },
      guardianToken,
    );
    expect(result).toMatchObject({ success: true });

    const req = (
      await getDb().collection('contactSharingRequests').doc(requestId).get()
    ).data()!;
    expect(req.status).toBe('declined');

    const kidNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', GOVERNED)
      .get();
    expect(kidNotifs.docs.some((d) => d.data().type === 'guardian_action')).toBe(true);

    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'contact_sharing_declined')
      .get();
    const entry = audits.docs
      .map((d) => d.data())
      .find((a) => a.details?.requestId === requestId)!;
    expect(entry.details.actorRole).toBe('guardian');
  });

  it('guardian can NEVER approve contact sharing (decline-only pin)', async () => {
    const requestId = await seedContactSharingRequest({
      babysitterUserId: GOVERNED,
      familyId: seed.family2Id,
    });

    await expect(
      callFunction('respondToContactSharing', { requestId, action: 'approve' }, guardianToken),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { code: 'guardian/decline-only' },
    });

    const req = (
      await getDb().collection('contactSharingRequests').doc(requestId).get()
    ).data()!;
    expect(req.status).toBe('pending');
    const kid = (await getDb().collection('users').doc(GOVERNED).get()).data()!;
    expect(kid.profiles.babysitter.approvedFamilies ?? []).not.toContain(seed.family2Id);
  });

  it('a pending, revoked, or absent link grants nothing', async () => {
    for (const target of [PENDING_KID, PLAIN]) {
      const appointmentId = await seedAppointment({
        babysitterUserId: target,
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'confirmed',
        date: FUTURE_MON,
      });
      await expect(
        callFunction(
          'cancelAppointment',
          { appointmentId, reason: 'Guardian check denied' },
          guardianToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(
        callFunction('respondToContactSharing', { requestId: 'nope', action: 'decline' }, guardianToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const apt = (await getDb().collection('appointments').doc(appointmentId).get()).data()!;
      expect(apt.status).toBe('confirmed');
    }

    // Revoked link → same refusal.
    await getDb().collection('guardianLinks').doc(PLAIN).set({
      childUid: PLAIN,
      familyId: seed.family1Id,
      createdByParentUid: seed.parent1.uid,
      status: 'revoked',
      origin: 'parent_created',
      requestedAt: new Date(),
      revokedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
    });
    const appointmentId = await seedAppointment({
      babysitterUserId: PLAIN,
      familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid,
      status: 'pending',
      date: FUTURE_MON,
    });
    await expect(
      callFunction('respondToRequest', { appointmentId, action: 'decline' }, guardianToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await getDb().collection('guardianLinks').doc(PLAIN).delete();
  });
});
