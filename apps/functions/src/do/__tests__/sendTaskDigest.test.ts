import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

// Per-recipient error isolation for the §10 board digest (PR #334 review).
// The batcher is a SCHEDULED job: nobody watches a browser console, and
// before this pin one rejecting recipient aborted the whole run — everyone
// after it in the map silently got nothing that hour. Collaborators are
// mocked because the emulator cannot fault-inject a rejecting write.

const h = vi.hoisted(() => ({
  sendDoNotificationToUser: vi.fn<(n: { recipientUserId: string }) => Promise<void>>(
    () => Promise.resolve(),
  ),
  stamped: [] as string[],
  failStampFor: new Set<string>(),
}));

vi.mock('../../config/firebase.js', () => ({ db: {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('../notify.js', () => ({
  sendDoNotificationToUser: (n: { recipientUserId: string }) =>
    h.sendDoNotificationToUser(n),
}));

import { runDoSendTaskDigest } from '../sendTaskDigest.js';

const NOW = new Date('2026-08-29T10:00:00Z');
const RECENT = new Date(NOW.getTime() - 60 * 60 * 1000);
const FUTURE = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

function task(taskId: string) {
  return {
    taskId,
    title: `Task ${taskId}`,
    category: 'green_thumb',
    areaLabel: '16e',
    suggestedBudget: 20,
    status: 'open',
    createdAt: RECENT,
    expiresAt: FUTURE,
  };
}

/** An enrolled, opted-in, never-digested doer matching the seeded task. */
function doer(uid: string) {
  return {
    uid,
    email: `${uid}@ejm.org`,
    language: 'en',
    status: 'active',
    profiles: {
      doer: {
        enrollmentComplete: true,
        notifyNewTasks: true,
        categories: ['green_thumb'],
      },
    },
  };
}

/**
 * The narrowest Firestore stand-in the batcher touches: two chained
 * `.where()` query builders and a per-uid `users/{uid}.update()`.
 */
function fakeDb(
  tasks: Record<string, unknown>[],
  users: Record<string, unknown>[],
): Firestore {
  const queryOver = (docs: unknown[]) => {
    const chain: Record<string, unknown> = {
      where: () => chain,
      get: () => Promise.resolve({ docs }),
    };
    return chain;
  };
  const taskDocs = tasks.map((t) => ({ data: () => t }));
  const userDocs = users.map((u) => ({ id: u.uid as string, data: () => u }));

  return {
    collection: (name: string) => ({
      ...queryOver(name === 'doTasks' ? taskDocs : userDocs),
      doc: (id: string) => ({
        update: () => {
          if (h.failStampFor.has(id)) {
            return Promise.reject(new Error(`stamp rejected for ${id}`));
          }
          h.stamped.push(id);
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as Firestore;
}

describe('runDoSendTaskDigest — per-recipient error isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sendDoNotificationToUser.mockImplementation(() => Promise.resolve());
    h.stamped = [];
    h.failStampFor = new Set();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('sends to every matching recipient and stamps each one on the happy path', async () => {
    const db = fakeDb([task('t1')], [doer('a'), doer('b'), doer('c')]);

    const stats = await runDoSendTaskDigest(db, NOW);

    expect(stats.recipientsMatched).toBe(3);
    expect(stats.digestsSent).toBe(3);
    expect(stats.errors).toBe(0);
    expect(h.stamped).toEqual(['a', 'b', 'c']);
  });

  it('a recipient whose notification write rejects does not stop the others', async () => {
    h.sendDoNotificationToUser.mockImplementation((n) =>
      n.recipientUserId === 'b'
        ? Promise.reject(new Error('deadline-exceeded'))
        : Promise.resolve(),
    );
    const db = fakeDb([task('t1')], [doer('a'), doer('b'), doer('c')]);

    const stats = await runDoSendTaskDigest(db, NOW);

    // 'c' comes AFTER the failing 'b' in map order — the regression this pins.
    expect(h.sendDoNotificationToUser).toHaveBeenCalledTimes(3);
    expect(stats.digestsSent).toBe(2);
    expect(stats.errors).toBe(1);
    // The failed recipient is NOT stamped, so the next hourly run retries it.
    expect(h.stamped).toEqual(['a', 'c']);
  });

  it('a rejecting lastDigestAt stamp is isolated and counted the same way', async () => {
    h.failStampFor = new Set(['a']);
    const db = fakeDb([task('t1')], [doer('a'), doer('b')]);

    const stats = await runDoSendTaskDigest(db, NOW);

    expect(stats.digestsSent).toBe(1);
    expect(stats.errors).toBe(1);
    expect(h.stamped).toEqual(['b']);
  });

  it('a malformed user doc is skipped, not fatal', async () => {
    const broken = {
      uid: 'x',
      // `profiles` is not an object of profiles — reading `.doer` off it is
      // the kind of shape a hand-edited/legacy doc can present.
      profiles: 'corrupt',
    };
    const db = fakeDb([task('t1')], [broken, doer('b')]);

    const stats = await runDoSendTaskDigest(db, NOW);

    expect(stats.digestsSent).toBe(1);
    expect(h.stamped).toEqual(['b']);
  });

  it('the run still reports its summary when a recipient fails', async () => {
    const logSpy = vi.spyOn(console, 'log');
    h.sendDoNotificationToUser.mockImplementation((n) =>
      n.recipientUserId === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve(),
    );
    const db = fakeDb([task('t1')], [doer('a'), doer('b')]);

    await runDoSendTaskDigest(db, NOW);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('errors=1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('sent=1'));
  });
});
