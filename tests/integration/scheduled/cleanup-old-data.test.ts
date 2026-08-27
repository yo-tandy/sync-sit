import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const require = createRequire(import.meta.url);
// Imported after `pnpm --filter @ejm/sit-core build && cd apps/functions && npx tsc`
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
      'notifications', 'auditLogs', 'inviteLinks', 'verificationCodes',
      'accountExistsNotices', 'verificationSendCounters', 'appointments',
      'publishedSearches',
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

  it('deletes account-exists notice markers older than 24h and keeps in-window ones (issue #148)', async () => {
    const db = getDb();
    const now = new Date();

    // Three stale markers exercise the round-6 drain loop (trivially — one
    // pass — since seeding 501+ docs would blow up integration runtime; the
    // loop's boundary condition `size < 500 -> break` is the same code path
    // either way).
    for (const name of ['stale1', 'stale2', 'stale3']) {
      await db.collection('accountExistsNotices').doc(`${name}@ejm.org`).set({
        email: `${name}@ejm.org`,
        lastSentAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      });
    }
    await db.collection('accountExistsNotices').doc('fresh@ejm.org').set({
      email: 'fresh@ejm.org',
      lastSentAt: new Date(now.getTime() - 23 * 60 * 60 * 1000),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.accountExistsNoticesDeleted).toBe(3);

    const remaining = await db.collection('accountExistsNotices').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe('fresh@ejm.org');
  });

  it('deletes verification send counters with an elapsed window and keeps live ones (issue #155)', async () => {
    const db = getDb();
    const now = new Date();

    // Both counter kinds go stale on the same 24h retention: the daily
    // address budget is spent by then and the 1h bypass budget long before.
    await db.collection('verificationSendCounters').doc('stale@ejm.org').set({
      key: 'stale@ejm.org',
      kind: 'address',
      count: 10,
      windowStart: new Date(now.getTime() - 25 * 60 * 60 * 1000),
    });
    await db.collection('verificationSendCounters').doc('stale-bypass-uid').set({
      key: 'stale-bypass-uid',
      kind: 'bypass',
      count: 6,
      windowStart: new Date(now.getTime() - 25 * 60 * 60 * 1000),
    });
    await db.collection('verificationSendCounters').doc('live@ejm.org').set({
      key: 'live@ejm.org',
      kind: 'address',
      count: 3,
      windowStart: new Date(now.getTime() - 23 * 60 * 60 * 1000),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.verificationSendCountersDeleted).toBe(2);

    const remaining = await db.collection('verificationSendCounters').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe('live@ejm.org');
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

  it('redacts appointment notes once the appointment leaves the UI window (issue #238)', async () => {
    const db = getDb();
    const now = new Date();

    // Out of reach: confirmed, sitting was 8 days ago -> BOTH notes redacted,
    // doc kept.
    const staleRef = await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      status: 'confirmed',
      date: daysAgo(8).toISOString().split('T')[0],
      createdAt: daysAgo(20),
      updatedAt: daysAgo(8),
      preAppointmentNote: 'Door code 1234B',
      postAppointmentNote: 'Kids asleep by 21:00',
    });
    // Out of reach: cancelled 8 days ago (updatedAt bound) -> redacted.
    const cancelledRef = await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      status: 'cancelled',
      date: daysFromNow(3).toISOString().split('T')[0],
      createdAt: daysAgo(10),
      updatedAt: daysAgo(8),
      preAppointmentNote: 'stale code',
    });
    // Still reachable: confirmed, sitting only 6 days ago -> notes kept.
    const recentRef = await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      status: 'confirmed',
      date: daysAgo(6).toISOString().split('T')[0],
      createdAt: daysAgo(10),
      updatedAt: daysAgo(6),
      preAppointmentNote: 'still visible',
    });
    // Always reachable: confirmed RECURRING (no date) -> notes kept forever.
    const recurringRef = await db.collection('appointments').add({
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      status: 'confirmed',
      type: 'recurring',
      createdAt: daysAgo(300),
      updatedAt: daysAgo(300),
      preAppointmentNote: 'door code for Mondays',
    });

    const stats = await runCleanupOldData(db, now);
    expect(stats.appointmentNotesRedacted).toBe(3); // stale pre+post, cancelled pre

    const stale = (await staleRef.get()).data()!;
    expect(stale.status).toBe('confirmed'); // doc itself survives
    expect('preAppointmentNote' in stale).toBe(false);
    expect('postAppointmentNote' in stale).toBe(false);
    expect('preAppointmentNote' in (await cancelledRef.get()).data()!).toBe(false);
    expect((await recentRef.get()).data()!.preAppointmentNote).toBe('still visible');
    expect((await recurringRef.get()).data()!.preAppointmentNote).toBe('door code for Mondays');
  });

  it('deletes expired published searches and keeps active ones (issue #207)', async () => {
    const db = getDb();
    const now = new Date();

    // Should be deleted: expired yesterday (both apps go through one sweep).
    await db.collection('publishedSearches').add({
      app: 'sit',
      familyId: seed.family1Id,
      expiresAt: daysAgo(1),
      createdAt: daysAgo(8),
    });

    // Should be kept: still active.
    const activeRef = await db.collection('publishedSearches').add({
      app: 'study',
      familyId: seed.family1Id,
      expiresAt: daysFromNow(3),
      createdAt: daysAgo(4),
    });

    const stats = await runCleanupOldData(db, now);

    expect(stats.publishedSearchesDeleted).toBe(1);

    const remaining = await db.collection('publishedSearches').get();
    expect(remaining.size).toBe(1);
    expect(remaining.docs[0].id).toBe(activeRef.id);
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
