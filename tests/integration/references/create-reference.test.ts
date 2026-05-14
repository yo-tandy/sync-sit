/**
 * Integration tests for the `notifyOnNewReference` Firestore trigger.
 *
 * This trigger fires when a new reference doc is written to the `references`
 * collection. For `type === 'family_submitted'` docs it creates an in-app
 * notification for the babysitter.
 *
 * Pattern: write the trigger source doc via admin SDK, then poll Firestore
 * for the side-effect notification (see §6.4 of the test plan handoff).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, seedReference, type SeedData } from '../../setup/seed.js';

// ─── poll helper ──────────────────────────────────────────────────────────────

async function waitForNotification(
  babysitterUserId: string,
  type: string,
  attempts = 15,
  delayMs = 300,
): Promise<FirebaseFirestore.DocumentData> {
  const db = getDb();
  for (let i = 0; i < attempts; i++) {
    const snap = await db
      .collection('notifications')
      .where('recipientUserId', '==', babysitterUserId)
      .where('type', '==', type)
      .get();
    if (snap.docs.length > 0) return snap.docs[0].data();
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Trigger never fired: no '${type}' notification for user ${babysitterUserId} after ${attempts * delayMs}ms`,
  );
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('notifyOnNewReference (Firestore trigger)', () => {
  let seed: SeedData;
  const db = getDb();

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    // Clear references and notifications between tests without wiping seed users.
    const [refSnap, notifSnap] = await Promise.all([
      db.collection('references').get(),
      db.collection('notifications').get(),
    ]);
    await Promise.all([
      ...refSnap.docs.map((d) => d.ref.delete()),
      ...notifSnap.docs.map((d) => d.ref.delete()),
    ]);
  });

  describe('happy path — family_submitted reference', () => {
    it('creates a reference_received notification for the babysitter', async () => {
      const refId = await seedReference({
        babysitterUserId: seed.babysitter1.uid,
        type: 'family_submitted',
        submittedByUserId: seed.parent1.uid,
        submittedByName: 'Marie Dupont',
        status: 'pending',
      });

      const notif = await waitForNotification(
        seed.babysitter1.uid,
        'reference_received',
      );

      expect(notif.recipientUserId).toBe(seed.babysitter1.uid);
      expect(notif.type).toBe('reference_received');
      expect(notif.read).toBe(false);
      expect(notif.data?.referenceId).toBe(refId);
    });

    it('notification body mentions the submitter name', async () => {
      await seedReference({
        babysitterUserId: seed.babysitter1.uid,
        type: 'family_submitted',
        submittedByUserId: seed.parent1.uid,
        submittedByName: 'Pierre Dupont',
        status: 'pending',
      });

      const notif = await waitForNotification(
        seed.babysitter1.uid,
        'reference_received',
      );

      expect(notif.body).toContain('Pierre Dupont');
    });
  });

  describe('trigger skip conditions', () => {
    it('does NOT create a notification for type=manual references', async () => {
      // Write a manual reference — trigger should return early (type check fails)
      await db.collection('references').add({
        babysitterUserId: seed.babysitter2.uid,
        type: 'manual',
        status: 'approved',
        fullName: 'Some Referee',
        phone: '+33 611111111',
        isEjmFamily: false,
        notes: 'Manual ref — no trigger notification expected.',
        createdAt: FieldValue.serverTimestamp(),
      });

      // Give the trigger time to fire if it was going to
      await new Promise((r) => setTimeout(r, 2000));

      const snap = await db
        .collection('notifications')
        .where('recipientUserId', '==', seed.babysitter2.uid)
        .where('type', '==', 'reference_received')
        .get();

      expect(snap.docs.length).toBe(0);
    });
  });
});
