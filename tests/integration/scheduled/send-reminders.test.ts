import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const require = createRequire(import.meta.url);
// Imported after `pnpm --filter @ejm/shared build && cd apps/functions && npx tsc`
const { runSendReminders } = require(
  '../../../apps/functions/dist/scheduled/sendReminders.js'
) as typeof import('../../../apps/functions/src/scheduled/sendReminders.js');

describe('runSendReminders', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const notifs = await db.collection('notifications').get();
    await Promise.all(notifs.docs.map((d) => d.ref.delete()));
    const apts = await db.collection('appointments').get();
    await Promise.all(apts.docs.map((d) => d.ref.delete()));
  });

  it('sends reminder for appointment exactly 24h away (babysitter + both parents)', async () => {
    const db = getDb();
    const now = new Date();
    // Place appointment at now + 24h exactly (within 23–25h window)
    const aptTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dateStr = aptTime.toISOString().split('T')[0];
    const startTime = `${String(aptTime.getUTCHours()).padStart(2, '0')}:${String(aptTime.getUTCMinutes()).padStart(2, '0')}`;

    await db.collection('appointments').add({
      familyId: seed.family1Id,
      familyName: 'Dupont',
      babysitterUserId: seed.babysitter1.uid,
      date: dateStr,
      startTime,
      status: 'confirmed',
      createdAt: now,
    });

    const stats = await runSendReminders(db, now);

    expect(stats.remindersSent).toBe(1);

    // Babysitter notification created
    const bsNotifs = await db
      .collection('notifications')
      .where('recipientUserId', '==', seed.babysitter1.uid)
      .where('type', '==', 'reminder')
      .get();
    expect(bsNotifs.size).toBe(1);

    // Both parents in family1 get notifications
    const parentNotifs = await db
      .collection('notifications')
      .where('recipientUserId', 'in', [seed.parent1.uid, seed.parent2.uid])
      .where('type', '==', 'reminder')
      .get();
    expect(parentNotifs.size).toBe(2);
  });

  it('skips appointment that already has reminderSent=true', async () => {
    const db = getDb();
    const now = new Date();
    const aptTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dateStr = aptTime.toISOString().split('T')[0];
    const startTime = `${String(aptTime.getUTCHours()).padStart(2, '0')}:${String(aptTime.getUTCMinutes()).padStart(2, '0')}`;

    await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      date: dateStr,
      startTime,
      status: 'confirmed',
      reminderSent: true,
      createdAt: now,
    });

    const stats = await runSendReminders(db, now);
    expect(stats.remindersSent).toBe(0);

    const notifs = await db.collection('notifications').get();
    expect(notifs.size).toBe(0);
  });

  it('skips appointment more than 25 hours away', async () => {
    const db = getDb();
    const now = new Date();
    // 26h away — outside the window
    const aptTime = new Date(now.getTime() + 26 * 60 * 60 * 1000);
    const dateStr = aptTime.toISOString().split('T')[0];
    const startTime = `${String(aptTime.getUTCHours()).padStart(2, '0')}:${String(aptTime.getUTCMinutes()).padStart(2, '0')}`;

    await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      date: dateStr,
      startTime,
      status: 'confirmed',
      createdAt: now,
    });

    const stats = await runSendReminders(db, now);
    expect(stats.remindersSent).toBe(0);
  });

  it('skips appointment less than 23 hours away', async () => {
    const db = getDb();
    const now = new Date();
    // 22h away — too soon
    const aptTime = new Date(now.getTime() + 22 * 60 * 60 * 1000);
    const dateStr = aptTime.toISOString().split('T')[0];
    const startTime = `${String(aptTime.getUTCHours()).padStart(2, '0')}:${String(aptTime.getUTCMinutes()).padStart(2, '0')}`;

    await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      date: dateStr,
      startTime,
      status: 'confirmed',
      createdAt: now,
    });

    const stats = await runSendReminders(db, now);
    expect(stats.remindersSent).toBe(0);
  });

  it('skips appointment with non-confirmed status (pending/cancelled)', async () => {
    const db = getDb();
    const now = new Date();
    const aptTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dateStr = aptTime.toISOString().split('T')[0];
    const startTime = `${String(aptTime.getUTCHours()).padStart(2, '0')}:${String(aptTime.getUTCMinutes()).padStart(2, '0')}`;

    // Non-confirmed status — query filters these out
    await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      date: dateStr,
      startTime,
      status: 'pending',
      createdAt: now,
    });
    await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      date: dateStr,
      startTime,
      status: 'cancelled',
      createdAt: now,
    });

    const stats = await runSendReminders(db, now);
    expect(stats.remindersSent).toBe(0);
  });
});
