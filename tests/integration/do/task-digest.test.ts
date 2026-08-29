import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb } from '../../setup/emulator.js';

const require = createRequire(import.meta.url);
// Imported from the compiled dist like the sweep and reminder suites: the
// testable unit is the extracted runner (the cron wrapper calls it with the
// real db + now).
const { runDoSendTaskDigest, DO_DIGEST_MIN_INTERVAL_MS } = require(
  '../../../apps/functions/dist/do/sendTaskDigest.js'
) as typeof import('../../../apps/functions/src/do/sendTaskDigest.js');

// doSendTaskDigest (plan §8's row, §10, §7.3): the scheduled batcher —
// recipient selection through the §7.3 users composite with the
// enrollmentComplete / lastDigestAt halves filtered IN MEMORY, at most one
// digest per student per 6h, board-visible content only, lastDigestAt
// written via the Admin SDK.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function seedDigestDoer(
  uid: string,
  overrides: Record<string, unknown> = {},
  rootOverrides: Record<string, unknown> = {},
) {
  await getDb().collection('users').doc(uid).set({
    uid,
    email: `${uid}@ejm.org`,
    status: 'active',
    firstName: `First-${uid}`,
    lastName: `Last-${uid}`,
    language: 'en',
    profiles: {
      doer: {
        enrollmentComplete: true,
        notifyNewTasks: true,
        categories: ['green_thumb'],
        bio: null, defaultRate: null, hasCar: false, hasBike: false,
        ...overrides,
      },
    },
    notifPrefs: {}, fcmTokens: [],
    createdAt: new Date(), updatedAt: new Date(),
    ...rootOverrides,
  });
}

async function seedOpenTask(taskId: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  await getDb().collection('doTasks').doc(taskId).set({
    taskId, familyId: 'digest-family', createdByUserId: 'digest-parent',
    familyName: 'Digest', areaLabel: '16e',
    category: 'green_thumb', subCategory: 'green_thumb_garden_watering',
    title: `Task ${taskId}`, description: 'x', photos: [],
    timing: 'ongoing', date: null, startTime: null, endTime: null,
    dueDate: null, startDate: '2026-08-01', endDate: null,
    cadence: { kind: 'daily' }, estimatedHours: null, suggestedBudget: 20,
    adultPresent: 'yes', toolsProvided: null, transportNeeded: false,
    status: 'open', offerCount: 0,
    assignedUserId: null, assignedOfferId: null, assignedAt: null,
    agreedPrice: null, doerMarkedDoneAt: null, completedAt: null,
    cancelledAt: null, cancelledBy: null,
    createdAt: new Date(now - HOUR_MS), updatedAt: new Date(now - HOUR_MS),
    expiresAt: new Date(now + 7 * DAY_MS),
    ...overrides,
  });
}

async function digestNotifsFor(uid: string) {
  const snap = await getDb()
    .collection('notifications')
    .where('recipientUserId', '==', uid)
    .where('type', '==', 'new_task_matching')
    .get();
  return snap.docs.map((d) => d.data());
}

async function lastDigestAtOf(uid: string): Promise<unknown> {
  const doc = await getDb().collection('users').doc(uid).get();
  return doc.data()?.profiles?.doer?.lastDigestAt;
}

describe('runDoSendTaskDigest (the §10 board digest)', () => {
  beforeAll(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    for (const coll of ['doTasks', 'taskOffers', 'notifications', 'users']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  });

  it('a matching doer gets ONE batched digest listing every matching task — board-visible fields only — and lastDigestAt is stamped', async () => {
    await seedDigestDoer('dg-match');
    await seedOpenTask('dg-t1');
    await seedOpenTask('dg-t2', { title: 'Task dg-t2', suggestedBudget: null });

    const stats = await runDoSendTaskDigest(getDb(), new Date());
    expect(stats.digestsSent).toBe(1);

    const notifs = await digestNotifsFor('dg-match');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe('2 new tasks for you');
    expect(notifs[0].data).toMatchObject({ taskCount: '2' });
    // Board-visible content only: the in-app body names no family and no
    // address — it is count + board facts (the email lists title/category/
    // area/budget, pinned in the notifyContent unit suite).
    expect(String(notifs[0].body)).not.toContain('digest-family');
    expect(String(notifs[0].body)).not.toContain('Digest');

    expect(await lastDigestAtOf('dg-match')).toBeTruthy();
  });

  it('non-matching category, notifyNewTasks off, enrollment incomplete, empty categories: no digest for any of them', async () => {
    await seedOpenTask('dg-t1');
    await seedDigestDoer('dg-other-cat', { categories: ['it'] });
    await seedDigestDoer('dg-opted-out', { notifyNewTasks: false });
    await seedDigestDoer('dg-half-enrolled', { enrollmentComplete: false });
    await seedDigestDoer('dg-empty-cats', { categories: [] });
    // A blocked account never gets a digest either (status gate is in the
    // composite).
    await seedDigestDoer('dg-blocked', {}, { status: 'blocked' });

    const stats = await runDoSendTaskDigest(getDb(), new Date());
    expect(stats.digestsSent).toBe(0);

    for (const uid of ['dg-other-cat', 'dg-opted-out', 'dg-half-enrolled', 'dg-empty-cats', 'dg-blocked']) {
      expect(await digestNotifsFor(uid)).toHaveLength(0);
      expect(await lastDigestAtOf(uid)).toBeUndefined();
    }
  });

  it('the 6h rate limit: a recipient digested <6h ago is skipped even with new matching tasks (seeded lastDigestAt)', async () => {
    const now = new Date();
    await seedDigestDoer('dg-recent', {
      lastDigestAt: new Date(now.getTime() - HOUR_MS), // 1h ago
    });
    await seedOpenTask('dg-t1'); // created 1h ago → after nothing, matching

    const stats = await runDoSendTaskDigest(getDb(), now);
    expect(stats.digestsSent).toBe(0);
    expect(await digestNotifsFor('dg-recent')).toHaveLength(0);
  });

  it('past the 6h window, only tasks created SINCE the last digest are batched — older ones are not repeated', async () => {
    const now = new Date();
    const lastDigest = new Date(now.getTime() - DO_DIGEST_MIN_INTERVAL_MS - HOUR_MS); // 7h ago
    await seedDigestDoer('dg-stale', { lastDigestAt: lastDigest });
    // Created 8h ago — BEFORE the last digest: already delivered, stays out.
    await seedOpenTask('dg-old', {
      title: 'Task dg-old',
      createdAt: new Date(now.getTime() - 8 * HOUR_MS),
    });
    // Created 1h ago — since the last digest: batched.
    await seedOpenTask('dg-new', { title: 'Task dg-new' });

    const stats = await runDoSendTaskDigest(getDb(), now);
    expect(stats.digestsSent).toBe(1);

    const notifs = await digestNotifsFor('dg-stale');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe('1 new task for you');
    expect(notifs[0].body).toContain('Task dg-new');
    expect(notifs[0].body).not.toContain('Task dg-old');
  });

  it('back-to-back runs: the first digests, the second is silenced by the lastDigestAt the first wrote', async () => {
    await seedDigestDoer('dg-repeat');
    await seedOpenTask('dg-t1');

    const first = await runDoSendTaskDigest(getDb(), new Date());
    expect(first.digestsSent).toBe(1);
    const second = await runDoSendTaskDigest(getDb(), new Date());
    expect(second.digestsSent).toBe(0);
    expect(await digestNotifsFor('dg-repeat')).toHaveLength(1);
  });

  it('non-open and expired tasks never enter a digest', async () => {
    await seedDigestDoer('dg-live-only');
    await seedOpenTask('dg-assigned', { status: 'assigned', assignedUserId: 'someone' });
    await seedOpenTask('dg-expired', { expiresAt: new Date(Date.now() - HOUR_MS) });

    const stats = await runDoSendTaskDigest(getDb(), new Date());
    expect(stats.digestsSent).toBe(0);
    expect(await digestNotifsFor('dg-live-only')).toHaveLength(0);
  });

  it('the digest bypasses NotifPrefs (notifyNewTasks IS the opt-in) and no per-app pref is consulted', async () => {
    await seedDigestDoer('dg-prefs-off', {}, {
      notifPrefs: {
        shared: { reminders: { push: false, email: false } },
        sit: {
          newRequest: { push: false, email: false },
          confirmed: { push: false, email: false },
          cancelled: { push: false, email: false },
        },
        study: {
          newRequest: { push: false, email: false },
          confirmed: { push: false, email: false },
          cancelled: { push: false, email: false },
        },
        do: {
          newRequest: { push: false, email: false },
          confirmed: { push: false, email: false },
          cancelled: { push: false, email: false },
        },
      },
    });
    await seedOpenTask('dg-t1');

    const stats = await runDoSendTaskDigest(getDb(), new Date());
    expect(stats.digestsSent).toBe(1);
    expect(await digestNotifsFor('dg-prefs-off')).toHaveLength(1);
  });
});
