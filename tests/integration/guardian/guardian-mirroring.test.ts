import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Notification mirroring trigger: a governed kid's notifications are CC'd to
// every parent of the supervising family as `guardian_mirror` copies with a
// deterministic doc id (`{originalId}_{parentUid}`) so trigger retries
// overwrite instead of duplicating.

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

const GOVERNED = 'gmKid'; // supervised by family1 (two parents)
const UNGOVERNED = 'gmPlain';

async function waitForDoc(
  collection: string,
  docId: string,
  attempts = 20,
  delayMs = 300,
): Promise<FirebaseFirestore.DocumentData> {
  const db = getDb();
  for (let i = 0; i < attempts; i++) {
    const snap = await db.collection(collection).doc(docId).get();
    if (snap.exists) return snap.data()!;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Trigger never fired: ${collection}/${docId} absent after ${attempts * delayMs}ms`);
}

describe('guardian notification mirroring', () => {
  let seed: SeedData;
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();

    for (const [uid, governed] of [
      [GOVERNED, true],
      [UNGOVERNED, false],
    ] as const) {
      await getDb().collection('users').doc(uid).set({
        uid,
        email: `${uid}@ejm.org`,
        status: 'active',
        firstName: 'Mika',
        lastName: 'Mirror',
        dateOfBirth: new Date('2013-02-15'),
        language: 'en',
        profiles: { babysitter: { enrollmentComplete: true, searchable: true } },
        notifPrefs: {},
        fcmTokens: [],
        ...(governed ? { governedBy: { familyId: seed.family1Id, linkedAt: new Date() } } : {}),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (governed) {
        await getDb().collection('guardianLinks').doc(uid).set({
          childUid: uid,
          familyId: seed.family1Id,
          createdByParentUid: seed.parent1.uid,
          status: 'active',
          origin: 'parent_created',
          requestedAt: new Date(),
          confirmedAt: new Date(),
          consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
        });
      }
    }
  });

  afterAll(async () => {
    await clearAll();
  });

  async function createNotification(
    recipientUserId: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    counter += 1;
    const id = `gmNotif${counter}`;
    await getDb().collection('notifications').doc(id).set({
      recipientUserId,
      type: 'request_cancelled',
      title: 'Appointment cancelled',
      body: 'A family has cancelled the appointment',
      data: { appointmentId: 'apt1' },
      read: false,
      channels: ['email', 'push'],
      emailSent: false,
      pushSent: false,
      createdAt: new Date(),
      ...over,
    });
    return id;
  }

  it("mirrors a governed kid's notification to EVERY parent of the family", async () => {
    const id = await createNotification(GOVERNED);

    const mirror1 = await waitForDoc('notifications', `${id}_${seed.parent1.uid}`);
    const mirror2 = await waitForDoc('notifications', `${id}_${seed.parent2.uid}`);

    for (const [mirror, parentUid] of [
      [mirror1, seed.parent1.uid],
      [mirror2, seed.parent2.uid],
    ] as const) {
      expect(mirror.recipientUserId).toBe(parentUid);
      expect(mirror.type).toBe('guardian_mirror');
      expect(mirror.title).toBe('[Mika] Appointment cancelled');
      expect(mirror.body).toBe('A family has cancelled the appointment');
      expect(mirror.data.originalType).toBe('request_cancelled');
      expect(mirror.data.mirroredFrom).toBe(GOVERNED);
      expect(mirror.data.appointmentId).toBe('apt1');
      expect(mirror.read).toBe(false);
    }

    // The kid's own notification is untouched.
    const original = (await getDb().collection('notifications').doc(id).get()).data()!;
    expect(original.type).toBe('request_cancelled');
    expect(original.recipientUserId).toBe(GOVERNED);
  });

  it('does not mirror for an ungoverned recipient', async () => {
    const id = await createNotification(UNGOVERNED);
    await new Promise((r) => setTimeout(r, 2500));
    const mirrors = await getDb()
      .collection('notifications')
      .where('type', '==', 'guardian_mirror')
      .get();
    expect(mirrors.docs.some((d) => d.id.startsWith(`${id}_`))).toBe(false);
  });

  it('skips guardian-flow types (no mirror loops, no supervision noise)', async () => {
    const askId = await createNotification(GOVERNED, {
      type: 'supervision_request',
      title: 'Supervision requested',
    });
    const mirrorId = await createNotification(GOVERNED, {
      type: 'guardian_mirror',
      title: '[Mika] already a mirror',
    });
    await new Promise((r) => setTimeout(r, 2500));
    const all = await getDb().collection('notifications').get();
    expect(all.docs.some((d) => d.id.startsWith(`${askId}_`))).toBe(false);
    expect(all.docs.some((d) => d.id.startsWith(`${mirrorId}_`))).toBe(false);
  });

  it('re-delivery of the same notification doc yields ONE mirror per parent', async () => {
    const id = 'gmRetryNotif';
    const doc = {
      recipientUserId: GOVERNED,
      type: 'request_declined',
      title: 'Request declined',
      body: 'Declined',
      data: {},
      read: false,
      channels: ['push'],
      emailSent: false,
      pushSent: false,
      createdAt: new Date(),
    };
    await getDb().collection('notifications').doc(id).set(doc);
    await waitForDoc('notifications', `${id}_${seed.parent1.uid}`);

    // Simulate a redelivery: delete + recreate fires onDocumentCreated again;
    // the deterministic mirror id makes the second firing overwrite.
    await getDb().collection('notifications').doc(id).delete();
    await getDb().collection('notifications').doc(id).set(doc);
    await waitForDoc('notifications', `${id}_${seed.parent2.uid}`);
    await new Promise((r) => setTimeout(r, 2000));

    const mirrors = await getDb().collection('notifications').get();
    const mine = mirrors.docs.filter((d) => d.id.startsWith(`${id}_`));
    expect(mine.length).toBe(2); // one per parent, not per firing
  });
});
