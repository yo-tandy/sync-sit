import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedStudyContactRequest, type SeedData } from '../../setup/seed.js';

// Guardian protective controls on the STUDY session/contact lifecycle.
// The guardian path is an AUTH EXTENSION: it reuses the exact cancel/decline
// machinery (status writes, override-ledger restore, lateCancellation
// snapshots, the existing family notification paths) and only adds the
// guardian resolution + kid-facing notification + audit actorRole.

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

// A far-future Monday; the governed tutor's grid is open 16:00–20:00 every day.
const FUTURE_MON = '2027-06-07';

function openGrid(): boolean[] {
  const slots = new Array(96).fill(false);
  for (let i = 64; i < 80; i++) slots[i] = true; // 16:00–20:00
  return slots;
}

function parisAt(hoursFromNow: number): { date: string; startTime: string } {
  const target = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(target)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, startTime: `${p.hour}:${p.minute}` };
}

const GOVERNED = 'gscTutor'; // supervised by family1
const PENDING_KID = 'gscPending'; // pending link only
const PLAIN = 'gscPlain'; // no link at all

describe('guardian protective controls — study', () => {
  let seed: SeedData;
  let guardianToken: string; // parent1 of family1 (the supervising family)
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    guardianToken = await getIdToken(seed.parent1.uid);

    const weekly = {
      mon: openGrid(), tue: openGrid(), wed: openGrid(), thu: openGrid(),
      fri: openGrid(), sat: openGrid(), sun: openGrid(),
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
        firstName: 'Gsc',
        lastName: uid,
        dateOfBirth: new Date('2013-02-15'),
        language: 'en',
        profiles: { tutor: { enrollmentComplete: true, searchable: true } },
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
    // Per-test hygiene: notifications and audit logs accumulate.
    const db = getDb();
    for (const coll of ['notifications', 'auditLogs']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  });

  /** Seed a study session for `tutorUid`, booked by family2. */
  async function seedSession(
    tutorUid: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    counter += 1;
    const id = `gscSes${counter}`;
    const doc: Record<string, unknown> = {
      sessionId: id,
      tutorUserId: tutorUid,
      tutorName: 'Gsc Tutor',
      familyId: seed.family2Id,
      familyName: 'Martin',
      type: 'one_time',
      status: 'confirmed',
      date: FUTURE_MON,
      startTime: '16:00',
      endTime: '17:00',
      subject: 'math',
      level: '6e',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
    if (doc.type === 'recurring') delete doc.date;
    await getDb().collection('study-sessions').doc(id).set(doc);
    return id;
  }

  /** Override doc holding exactly the session's 16:00–17:00 claim. */
  async function seedClaimOverride(
    tutorUid: string,
    date: string,
    sessionId: string,
    instanceId?: string,
  ) {
    const slots = openGrid();
    for (let i = 64; i < 68; i++) slots[i] = false;
    await getDb()
      .collection('schedules')
      .doc(tutorUid)
      .collection('overrides')
      .doc(date)
      .set({
        date,
        type: 'custom',
        slots,
        sessionBlocks: [
          { sessionId, startIdx: 64, endIdx: 68, ...(instanceId ? { instanceId } : {}) },
        ],
        appSource: 'study',
        reason: 'study_session',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }

  it('guardian cancels a confirmed one_time session through the full machinery', async () => {
    const sessionId = await seedSession(GOVERNED, { cancellationNoticeHours: 48 });
    await seedClaimOverride(GOVERNED, FUTURE_MON, sessionId);

    const result = await callFunction(
      'cancelSession',
      { sessionId, reason: 'Guardian decision' },
      guardianToken,
    );
    expect(result).toMatchObject({ success: true });

    // Same machinery as a tutor cancel: provider-side statusReason…
    const ses = (await getDb().collection('study-sessions').doc(sessionId).get()).data()!;
    expect(ses.status).toBe('cancelled');
    expect(ses.statusReason).toBe('cancelled_by_tutor');
    expect(ses.cancelledFromStatus).toBe('confirmed');
    expect(ses.lateCancellation).toBeUndefined(); // far future — not late

    // …override-ledger restore ran (the claim-only doc is deleted)…
    const override = await getDb()
      .collection('schedules')
      .doc(GOVERNED)
      .collection('overrides')
      .doc(FUTURE_MON)
      .get();
    expect(override.exists).toBe(false);

    // …the session's family was notified via the EXISTING path…
    const famNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', seed.parent3.uid)
      .get();
    expect(famNotifs.docs.some((d) => d.data().type === 'study_session_cancelled')).toBe(true);

    // …the kid was told a parent acted…
    const kidNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', GOVERNED)
      .get();
    expect(kidNotifs.docs.some((d) => d.data().type === 'guardian_action')).toBe(true);

    // …and the audit records the guardian actor.
    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'session_cancelled')
      .get();
    const entry = audits.docs.map((d) => d.data()).find((a) => a.details?.sessionId === sessionId)!;
    expect(entry.adminUserId).toBe(seed.parent1.uid);
    expect(entry.details.actorRole).toBe('guardian');
  });

  it('a guardian cancel inside the notice window is a late cancellation (snapshot unchanged)', async () => {
    const { date, startTime } = parisAt(24); // inside the 48h window
    const sessionId = await seedSession(GOVERNED, {
      date,
      startTime,
      cancellationNoticeHours: 48,
    });

    await callFunction('cancelSession', { sessionId, reason: 'Urgent' }, guardianToken);
    const ses = (await getDb().collection('study-sessions').doc(sessionId).get()).data()!;
    expect(ses.status).toBe('cancelled');
    expect(ses.lateCancellation).toBe(true);
  });

  it('guardian cancels a single recurring instance with slot restoration', async () => {
    const sessionId = await seedSession(GOVERNED, {
      type: 'recurring',
      cancellationNoticeHours: 0,
    });
    await getDb()
      .collection('study-sessions')
      .doc(sessionId)
      .collection('instances')
      .doc(FUTURE_MON)
      .set({
        sessionId,
        tutorUserId: GOVERNED,
        familyId: seed.family2Id,
        date: FUTURE_MON,
        startTime: '16:00',
        endTime: '17:00',
        status: 'scheduled',
      });
    await seedClaimOverride(GOVERNED, FUTURE_MON, sessionId, FUTURE_MON);

    const result = await callFunction(
      'cancelSessionInstance',
      { sessionId, instanceId: FUTURE_MON, reason: 'Guardian decision' },
      guardianToken,
    );
    expect(result).toMatchObject({ success: true });

    const inst = (
      await getDb()
        .collection('study-sessions')
        .doc(sessionId)
        .collection('instances')
        .doc(FUTURE_MON)
        .get()
    ).data()!;
    expect(inst.status).toBe('cancelled');
    expect(inst.statusReason).toBe('cancelled_by_tutor');

    const override = await getDb()
      .collection('schedules')
      .doc(GOVERNED)
      .collection('overrides')
      .doc(FUTURE_MON)
      .get();
    expect(override.exists).toBe(false);

    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'session_instance_cancelled')
      .get();
    const entry = audits.docs.map((d) => d.data()).find((a) => a.details?.sessionId === sessionId)!;
    expect(entry.details.actorRole).toBe('guardian');

    const kidNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', GOVERNED)
      .get();
    expect(kidNotifs.docs.some((d) => d.data().type === 'guardian_action')).toBe(true);
  });

  it('guardian declines a pending session request', async () => {
    const sessionId = await seedSession(GOVERNED, { status: 'pending' });

    const result = await callFunction(
      'respondToSession',
      { sessionId, action: 'decline' },
      guardianToken,
    );
    expect(result).toMatchObject({ success: true });

    const ses = (await getDb().collection('study-sessions').doc(sessionId).get()).data()!;
    expect(ses.status).toBe('declined');
    expect(ses.statusReason).toBe('declined_by_tutor');

    const kidNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', GOVERNED)
      .get();
    expect(kidNotifs.docs.some((d) => d.data().type === 'guardian_action')).toBe(true);

    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'session_declined')
      .get();
    const entry = audits.docs.map((d) => d.data()).find((a) => a.details?.sessionId === sessionId)!;
    expect(entry.details.actorRole).toBe('guardian');
  });

  it('guardian can NEVER confirm a session (decline-only pin)', async () => {
    const sessionId = await seedSession(GOVERNED, { status: 'pending' });

    await expect(
      callFunction('respondToSession', { sessionId, action: 'confirm' }, guardianToken),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { code: 'guardian/decline-only' },
    });

    const ses = (await getDb().collection('study-sessions').doc(sessionId).get()).data()!;
    expect(ses.status).toBe('pending'); // untouched
  });

  it('guardian declines a pending contact request', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: GOVERNED,
      familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid,
      message: 'Please help',
    });

    const result = await callFunction(
      'respondToTutorContactRequest',
      { requestId, action: 'decline' },
      guardianToken,
    );
    expect(result).toMatchObject({ success: true });

    const req = (await getDb().collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(req.status).toBe('declined');

    // Existing family notification path ran.
    const famNotifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', seed.parent3.uid)
      .get();
    expect(famNotifs.docs.some((d) => d.data().type === 'study_request_declined')).toBe(true);

    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'tutor_contact_request_declined')
      .get();
    const entry = audits.docs.map((d) => d.data()).find((a) => a.details?.requestId === requestId)!;
    expect(entry.details.actorRole).toBe('guardian');
  });

  it('guardian can NEVER accept a contact request (decline-only pin)', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: GOVERNED,
      familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid,
    });

    await expect(
      callFunction('respondToTutorContactRequest', { requestId, action: 'accept' }, guardianToken),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { code: 'guardian/decline-only' },
    });

    const req = (await getDb().collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(req.status).toBe('pending');
    // No contact unlock happened.
    const kid = (await getDb().collection('users').doc(GOVERNED).get()).data()!;
    expect(kid.profiles.tutor.approvedFamilies ?? []).not.toContain(seed.family2Id);
  });

  it('a pending or absent link grants nothing, and a random parent stays denied', async () => {
    // Pending link → the guardian path must not resolve.
    const pendingSes = await seedSession(PENDING_KID);
    await expect(
      callFunction('cancelSession', { sessionId: pendingSes, reason: 'Guardian check denied' }, guardianToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // No link at all (the pre-existing denial, still intact).
    const plainSes = await seedSession(PLAIN);
    await expect(
      callFunction('cancelSession', { sessionId: plainSes, reason: 'Guardian check denied' }, guardianToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Revoked link → also nothing.
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
    await expect(
      callFunction('cancelSession', { sessionId: plainSes, reason: 'Guardian check denied' }, guardianToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await getDb().collection('guardianLinks').doc(PLAIN).delete();

    // Sessions untouched throughout.
    for (const id of [pendingSes, plainSes]) {
      const ses = (await getDb().collection('study-sessions').doc(id).get()).data()!;
      expect(ses.status).toBe('confirmed');
    }
  });
});
