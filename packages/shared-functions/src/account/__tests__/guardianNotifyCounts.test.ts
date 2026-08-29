import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The guardian notification's audit counts (issue #368).
 *
 * `guardiansReached` must count DELIVERIES, not loop iterations. An earlier
 * version incremented once per parent whose user doc existed, so a guardian
 * with a failed email and no push registration was logged as informed — the
 * exact silent failure the field exists to catch.
 *
 * Pinned here rather than in the emulator suite deliberately: the emulator's
 * `sendNotificationEmail` short-circuits to `true` for any address, and every
 * production writer of a `users` doc sets `email`, so an integration test
 * cannot stage a both-channels-missed guardian without inventing a document
 * shape production never writes. Production reaches it easily (Resend rejects
 * the send; the parent never installed a PWA). Mocking the two transports
 * makes the channel results an INPUT — it does not borrow an assumption from
 * the code under test, which is the counting itself.
 *
 * The end-to-end half — that the erasure runs, that the supervising family is
 * still known when this is called, and that `guardiansFound` counts the
 * parents the family names — lives in
 * `tests/integration/account/delete-my-account.test.ts`.
 */

const h = vi.hoisted(() => ({
  parents: [] as string[],
  users: new Map<string, Record<string, unknown> | undefined>(),
  // Per-recipient transport outcomes: the INPUT this suite varies.
  email: ((_to: string) => true) as (to: string) => boolean,
  push: ((_uid: string) => false) as (uid: string) => boolean,
  written: [] as Record<string, unknown>[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'families') {
        return { doc: () => ({ get: async () => ({ data: () => ({ parentIds: h.parents }) }) }) };
      }
      if (name === 'users') {
        return { doc: (id: string) => ({ get: async () => ({ data: () => h.users.get(id) }) }) };
      }
      if (name === 'notifications') {
        return {
          add: async (doc: Record<string, unknown>) => {
            h.written.push(doc);
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  },
}));

vi.mock('../../config/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/email.js')>();
  return { ...actual, sendNotificationEmail: async (to: string) => h.email(to) };
});

vi.mock('../../config/push.js', () => ({
  sendPushNotification: async (uid: string) => h.push(uid),
}));

import { notifyGuardiansOfSelfDelete } from '../deleteMyAccount.js';

describe('guardian notification counts', () => {
  beforeEach(() => {
    h.parents = ['p1', 'p2'];
    h.users = new Map([
      ['p1', { email: 'p1@example.com' }],
      ['p2', { email: 'p2@example.com' }],
    ]);
    h.email = () => true;
    h.push = () => false;
    h.written.length = 0;
  });

  it('counts a guardian reached by email alone', async () => {
    expect(await notifyGuardiansOfSelfDelete('fam1', 'kid1', 'Zoe Dupont')).toEqual({
      found: 2,
      reached: 2,
    });
  });

  it('counts a guardian reached by push alone', async () => {
    h.email = () => false;
    h.push = () => true;
    expect(await notifyGuardiansOfSelfDelete('fam1', 'kid1', 'Zoe Dupont')).toEqual({
      found: 2,
      reached: 2,
    });
  });

  it('counts NOBODY reached when every channel fails, though the docs are written', async () => {
    // THE pin. Both guardians exist and are iterated; neither is told.
    h.email = () => false;
    h.push = () => false;
    expect(await notifyGuardiansOfSelfDelete('fam1', 'kid1', 'Zoe Dupont')).toEqual({
      found: 2,
      reached: 0,
    });
    // The in-app doc is still written for both — and is deliberately NOT a
    // channel that counts, or `reached` would be unconditional again.
    expect(h.written).toHaveLength(2);
    expect(h.written.every((d) => d.emailSent === false && d.pushSent === false)).toBe(true);
  });

  it('counts the reached guardian and not the missed one', async () => {
    // p1's mail lands, p2's is rejected — the mixed case a single count cannot
    // express, and the one an operator most needs to see in the audit trail.
    h.email = (to) => to === 'p1@example.com';
    expect(await notifyGuardiansOfSelfDelete('fam1', 'kid1', 'Zoe Dupont')).toEqual({
      found: 2,
      reached: 1,
    });
    const [d1, d2] = h.written;
    expect(d1.recipientUserId).toBe('p1');
    expect(d1.emailSent).toBe(true);
    expect(d2.recipientUserId).toBe('p2');
    expect(d2.emailSent).toBe(false);
  });

  it('a guardian with no user doc is FOUND but never reached, and gets no doc', async () => {
    h.parents = ['p1', 'ghost'];
    expect(await notifyGuardiansOfSelfDelete('fam1', 'kid1', 'Zoe Dupont')).toEqual({
      found: 2,
      reached: 1,
    });
    expect(h.written).toHaveLength(1);
    expect(h.written[0].recipientUserId).toBe('p1');
  });

  it('a family with no parents at all is found: 0, not an error', async () => {
    h.parents = [];
    expect(await notifyGuardiansOfSelfDelete('fam1', 'kid1', 'Zoe Dupont')).toEqual({
      found: 0,
      reached: 0,
    });
    expect(h.written).toHaveLength(0);
  });

  it('never puts the erased member\'s name in the durable doc payload', async () => {
    await notifyGuardiansOfSelfDelete('fam1', 'kid1', 'Zoe Dupont');
    for (const doc of h.written) {
      expect(doc.data).toEqual({ childUid: 'kid1' });
      expect(JSON.stringify(doc.data)).not.toContain('Zoe');
    }
  });
});
