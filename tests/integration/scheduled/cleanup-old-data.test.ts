import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const require = createRequire(import.meta.url);
// Imported after `pnpm --filter @ejm/shared build && cd apps/functions && npx tsc`
const { runCleanupOldData } = require(
  '../../../apps/functions/dist/scheduled/cleanupOldData.js'
) as typeof import('../../../apps/functions/src/scheduled/cleanupOldData.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY_MS);
}

describe('runCleanupOldData', () => {
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
    const collections = [
      'notifications', 'auditLogs', 'inviteLinks', 'verificationCodes', 'appointments',
    ];
    await Promise.all(
      collections.map(async (col) => {
        const docs = await db.collection(col).get();
        await Promise.all(docs.docs.map((d) => d.ref.delete()));
      }),
    );
  });

  it('deletes notifications older than 30 days and keeps recent ones', async () => {
    const db = getDb();
    const now = new Date();

    await db.collection('notifications').add({
      recipientUserId: seed.parent1.uid,
      type: 'test',
      createdAt: daysAgo(31),
    });
    const recentRef = await db.collection('notifications').add({
      recipientUserId: seed.parent1.uid,
      type: 'test',
      createdAt: daysAgo(29),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.notificationsDeleted).toBe(1);

    const remaining = await db.collection('notifications').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe(recentRef.id);
  });

  it('deletes expired invite links and keeps valid ones', async () => {
    const db = getDb();
    const now = new Date();

    await db.collection('inviteLinks').add({
      familyId: seed.family1Id,
      expiresAt: daysAgo(1),
    });
    const validRef = await db.collection('inviteLinks').add({
      familyId: seed.family1Id,
      expiresAt: daysFromNow(7),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.inviteLinksDeleted).toBe(1);

    const remaining = await db.collection('inviteLinks').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe(validRef.id);
  });

  it('deletes expired verification codes and keeps valid ones', async () => {
    const db = getDb();
    const now = new Date();

    await db.collection('verificationCodes').add({
      familyId: seed.family1Id,
      code: 'EXPIRED',
      expiresAt: daysAgo(1),
    });
    const validRef = await db.collection('verificationCodes').add({
      familyId: seed.family1Id,
      code: 'VALID01',
      expiresAt: daysFromNow(1),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.verificationCodesDeleted).toBe(1);

    const remaining = await db.collection('verificationCodes').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe(validRef.id);
  });

  it('deletes old cancelled appointments (createdAt>30d, date>7d ago) but keeps recent ones', async () => {
    const db = getDb();
    const now = new Date();

    // Should be deleted: created 31 days ago, date was 8 days ago
    await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      status: 'cancelled',
      date: daysAgo(8).toISOString().split('T')[0],
      createdAt: daysAgo(31),
    });

    // Should be kept: created 31 days ago but date is only 6 days ago (still within 7-day grace)
    const recentRef = await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      status: 'cancelled',
      date: daysAgo(6).toISOString().split('T')[0],
      createdAt: daysAgo(31),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.appointmentsDeleted).toBe(1);

    const remaining = await db.collection('appointments').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe(recentRef.id);
  });

  it('deletes old audit logs and keeps recent ones', async () => {
    const db = getDb();
    const now = new Date();

    await db.collection('auditLogs').add({
      action: 'test',
      timestamp: daysAgo(31),
    });
    const recentRef = await db.collection('auditLogs').add({
      action: 'test',
      timestamp: daysAgo(29),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.auditLogsDeleted).toBe(1);

    const remaining = await db.collection('auditLogs').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe(recentRef.id);
  });
});
