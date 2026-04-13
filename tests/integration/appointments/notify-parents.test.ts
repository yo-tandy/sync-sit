import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('parent notifications via notifyAllParents', () => {
  let seed: SeedData;
  let babysitterToken: string;
  const db = getDb();

  // Appointment IDs created in setup
  const aptConfirmedDupont = 'apt-test-confirmed-dupont';
  const aptPendingAccept = 'apt-test-pending-accept';
  const aptPendingDecline = 'apt-test-pending-decline';
  const aptConfirmedMartin = 'apt-test-confirmed-martin';

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    babysitterToken = await getIdToken(seed.babysitter1.uid);

    // Create test appointments directly in Firestore
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const baseApt = {
      familyId: seed.family1Id,
      familyName: 'Dupont',
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      date: dateStr,
      startTime: '18:00',
      endTime: '21:00',
      kidIds: ['kid1'],
      kids: [{ age: 6, languages: ['French'] }],
      address: '15 Rue de Passy, 75016 Paris',
      offeredRate: 12,
      createdAt: now,
      updatedAt: now,
    };

    // Confirmed appointment for Dupont (cancel test)
    await db.collection('appointments').doc(aptConfirmedDupont).set({
      ...baseApt,
      appointmentId: aptConfirmedDupont,
      type: 'one_time',
      status: 'confirmed',
      confirmedAt: now,
    });

    // Pending appointment for accept test
    await db.collection('appointments').doc(aptPendingAccept).set({
      ...baseApt,
      appointmentId: aptPendingAccept,
      type: 'one_time',
      status: 'pending',
    });

    // Pending appointment for decline test
    await db.collection('appointments').doc(aptPendingDecline).set({
      ...baseApt,
      appointmentId: aptPendingDecline,
      type: 'one_time',
      status: 'pending',
    });

    // Confirmed appointment for Martin (single parent, cancel test)
    await db.collection('appointments').doc(aptConfirmedMartin).set({
      ...baseApt,
      appointmentId: aptConfirmedMartin,
      type: 'one_time',
      status: 'confirmed',
      confirmedAt: now,
      familyId: seed.family2Id,
      familyName: 'Martin',
      createdByUserId: seed.parent3.uid,
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  async function getNotificationsForUser(userId: string, type?: string) {
    let q = db.collection('notifications').where('recipientUserId', '==', userId);
    if (type) q = q.where('type', '==', type);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }

  it('both parents get notification when babysitter cancels', async () => {
    await callFunction(
      'cancelAppointment',
      { appointmentId: aptConfirmedDupont, reason: 'Family emergency' },
      babysitterToken
    );

    const parent1Notifs = await getNotificationsForUser(seed.parent1.uid, 'request_cancelled');
    const parent2Notifs = await getNotificationsForUser(seed.parent2.uid, 'request_cancelled');

    expect(parent1Notifs.length).toBe(1);
    expect(parent2Notifs.length).toBe(1);
  });

  it('cancel notification body includes the reason', async () => {
    const notifs = await getNotificationsForUser(seed.parent1.uid, 'request_cancelled');
    expect(notifs[0].body).toContain('Family emergency');
  });

  it('both parents get notification when babysitter accepts', async () => {
    await callFunction(
      'respondToRequest',
      { appointmentId: aptPendingAccept, action: 'accept' },
      babysitterToken
    );

    const parent1Notifs = await getNotificationsForUser(seed.parent1.uid, 'request_accepted');
    const parent2Notifs = await getNotificationsForUser(seed.parent2.uid, 'request_accepted');

    expect(parent1Notifs.length).toBe(1);
    expect(parent2Notifs.length).toBe(1);
    expect(parent1Notifs[0].title).toBe('Babysitting confirmed');
  });

  it('both parents get notification when babysitter declines', async () => {
    await callFunction(
      'respondToRequest',
      { appointmentId: aptPendingDecline, action: 'decline' },
      babysitterToken
    );

    const parent1Notifs = await getNotificationsForUser(seed.parent1.uid, 'request_declined');
    const parent2Notifs = await getNotificationsForUser(seed.parent2.uid, 'request_declined');

    expect(parent1Notifs.length).toBe(1);
    expect(parent2Notifs.length).toBe(1);
    expect(parent1Notifs[0].title).toBe('Request declined');
  });

  it('single-parent family gets exactly one notification', async () => {
    await callFunction(
      'cancelAppointment',
      { appointmentId: aptConfirmedMartin, reason: 'Schedule conflict' },
      babysitterToken
    );

    const parent3Notifs = await getNotificationsForUser(seed.parent3.uid, 'request_cancelled');
    expect(parent3Notifs.length).toBe(1);
    expect(parent3Notifs[0].body).toContain('Schedule conflict');
  });
});
