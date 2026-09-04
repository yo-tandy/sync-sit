import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The erasure counterparty fan-out's counting, deduplication, and payload
 * discipline (issue #420).
 *
 * Pinned here rather than in the emulator suite for the reason
 * `guardianNotifyCounts.test.ts` states: the emulator's mail transport
 * short-circuits to `true` for any address, so a both-channels-missed
 * recipient — the exact state `found > reached` exists to surface — cannot be
 * staged there without seeding a document shape production never writes.
 * Mocking the transports makes the channel results an INPUT.
 *
 * The end-to-end half — that the erasure actually collects the right
 * counterparties from the cancel loops and that both callables carry the
 * counts to their audit entries — lives in
 * `tests/integration/admin/delete-user.test.ts` and
 * `tests/integration/account/delete-my-account.test.ts`.
 */

const h = vi.hoisted(() => ({
  families: new Map<string, string[] | undefined>(),
  users: new Map<string, Record<string, unknown> | undefined>(),
  // Per-recipient transport outcomes: the INPUT this suite varies.
  email: ((_to: string) => true) as (to: string) => boolean,
  push: ((_uid: string) => false) as (uid: string) => boolean,
  written: [] as Record<string, unknown>[],
  // The (app, world) pair each push was routed with — see the 'auto' test.
  pushRouting: [] as unknown[][],
  pushPayloads: [] as (Record<string, string> | undefined)[],
  // Recipient uids whose `users` doc read should throw.
  throwsOnGet: new Set<string>(),
  // Family ids whose lookup should throw — per-family isolation input.
  familyGetThrows: new Set<string>(),
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'families') {
        return {
          doc: (id: string) => ({
            get: async () => {
              if (h.familyGetThrows.has(id)) throw new Error(`family ${id} lookup failed`);
              const parentIds = h.families.get(id);
              return { data: () => (parentIds ? { parentIds } : undefined) };
            },
          }),
        };
      }
      if (name === 'users') {
        return {
          doc: (id: string) => ({
            get: async () => {
              if (h.throwsOnGet.has(id)) throw new Error(`transient failure for ${id}`);
              return { data: () => h.users.get(id) };
            },
          }),
        };
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
  sendPushNotification: async (
    uid: string,
    _title: string,
    _body: string,
    data?: Record<string, string>,
    app?: unknown,
    world?: unknown,
  ) => {
    h.pushRouting.push([app, world]);
    h.pushPayloads.push(data);
    return h.push(uid);
  },
}));

import {
  emptyCounterpartyTargets,
  notifyErasureCounterparties,
} from '../erasureCounterpartyNotify.js';

const NOW = new Date('2026-09-04T10:00:00Z');

describe('erasure counterparty notification', () => {
  beforeEach(() => {
    h.families = new Map([['fam1', ['p1', 'p2']]]);
    h.users = new Map([
      ['p1', { email: 'p1@example.com' }],
      ['p2', { email: 'p2@example.com' }],
      ['sitter1', { email: 'sitter1@example.com' }],
      ['tutor1', { email: 'tutor1@example.com' }],
    ]);
    h.email = () => true;
    h.push = () => false;
    h.written.length = 0;
    h.pushRouting.length = 0;
    h.pushPayloads.length = 0;
    h.throwsOnGet.clear();
    h.familyGetThrows.clear();
  });

  it('resolves a sit family to EVERY parent, one aggregated message each', async () => {
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 3); // three cancelled appointments, ONE family
    const result = await notifyErasureCounterparties('erased', targets, 'Marie Dupont', NOW);
    expect(result).toEqual({ found: 2, reached: 2 });
    expect(h.written.map((d) => d.recipientUserId).sort()).toEqual(['p1', 'p2']);
    for (const doc of h.written) {
      expect(doc.type).toBe('account_deleted');
      // One message saying three — never three messages.
      expect(doc.data).toEqual({ cancelledCount: '3' });
      expect(doc.body).toContain('Marie Dupont');
      expect(doc.body).toContain('3 appointments');
    }
  });

  it('a provider counterparty is one recipient however many appointments were cancelled', async () => {
    const targets = emptyCounterpartyTargets();
    targets.sitProviders.set('sitter1', 2);
    const result = await notifyErasureCounterparties('erased', targets, 'Sophie Martin', NOW);
    expect(result).toEqual({ found: 1, reached: 1 });
    expect(h.written).toHaveLength(1);
    expect(h.written[0].recipientUserId).toBe('sitter1');
    expect(h.written[0].body).toContain("Sophie Martin's family");
    // The provider flavor tells them their blocked slots came back.
    expect(h.written[0].body).toContain('reopened');
  });

  it('study counterparties get the study type, study branding, and session wording', async () => {
    const targets = emptyCounterpartyTargets();
    targets.studyFamilies.set('fam1', 1);
    targets.studyTutors.set('tutor1', 2);
    await notifyErasureCounterparties('erased', targets, 'Marie Dupont', NOW);
    const byUid = new Map(h.written.map((d) => [d.recipientUserId, d]));
    expect(byUid.get('p1')!.type).toBe('study_account_deleted');
    expect(byUid.get('p1')!.body).toContain('tutoring session');
    expect(byUid.get('tutor1')!.type).toBe('study_account_deleted');
    expect(byUid.get('tutor1')!.body).toContain('2 tutoring sessions');
  });

  it("routes every push with 'auto' plus the world as the tie-break hint", async () => {
    // 'auto' resolves per recipient to whichever PWA they installed; the
    // world hint only breaks dual-install ties. An explicit app would read
    // that app's token array ALONE and silently drop recipients who only
    // installed the sibling PWA — the guardianNotifyCounts pin, both halves.
    const targets = emptyCounterpartyTargets();
    targets.sitProviders.set('sitter1', 1);
    targets.studyTutors.set('tutor1', 1);
    await notifyErasureCounterparties('erased', targets, 'X Y', NOW);
    expect(h.pushRouting.sort()).toEqual([
      ['auto', 'sit'],
      ['auto', 'study'],
    ]);
  });

  it('names the erased member in the human copy ONLY — the payload is count-only', async () => {
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 1);
    await notifyErasureCounterparties('erased', targets, 'Marie Dupont', NOW);
    for (const doc of h.written) {
      expect(doc.body).toContain('Marie Dupont');
      expect(doc.data).toEqual({ cancelledCount: '1' });
      expect(JSON.stringify(doc.data)).not.toContain('Marie');
    }
    for (const payload of h.pushPayloads) {
      expect(Object.keys(payload!).sort()).toEqual(['cancelledCount', 'type']);
    }
  });

  it('counts NOBODY reached when every channel fails, though the docs are written', async () => {
    h.email = () => false;
    h.push = () => false;
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 1);
    expect(await notifyErasureCounterparties('erased', targets, 'X Y', NOW)).toEqual({
      found: 2,
      reached: 0,
    });
    // The in-app doc is the recipient's only durable record then — written,
    // but deliberately not counted as a channel.
    expect(h.written).toHaveLength(2);
    expect(h.written.every((d) => d.emailSent === false && d.pushSent === false)).toBe(true);
  });

  it('a recipient whose user doc read throws is found but not reached; the rest still get theirs', async () => {
    h.throwsOnGet.add('p1');
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 1);
    expect(await notifyErasureCounterparties('erased', targets, 'X Y', NOW)).toEqual({
      found: 2,
      reached: 1,
    });
    expect(h.written.map((d) => d.recipientUserId)).toEqual(['p2']);
  });

  it('a family whose doc is gone contributes nobody — a deleted family has no one left to tell', async () => {
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('ghost-family', 4);
    expect(await notifyErasureCounterparties('erased', targets, 'X Y', NOW)).toEqual({
      found: 0,
      reached: 0,
    });
    expect(h.written).toHaveLength(0);
  });

  it('one failing family lookup does not cost the other families their parents', async () => {
    h.families.set('fam2', ['sitter1']);
    h.familyGetThrows.add('fam1');
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 1);
    targets.sitFamilies.set('fam2', 1);
    const result = await notifyErasureCounterparties('erased', targets, 'X Y', NOW);
    expect(result).toEqual({ found: 1, reached: 1 });
    expect(h.written[0].recipientUserId).toBe('sitter1');
  });

  it("filters the erased member and the 'deleted' sentinel out of every recipient list", async () => {
    // A target map built from raw document fields can name either: the erased
    // member sits in their own family's parentIds until step 4 trims it, and
    // an appointment cancelled twice over may carry the sentinel.
    h.families.set('fam1', ['p1', 'erased', 'deleted']);
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 1);
    targets.sitProviders.set('erased', 1);
    targets.sitProviders.set('deleted', 1);
    const result = await notifyErasureCounterparties('erased', targets, 'X Y', NOW);
    expect(result).toEqual({ found: 1, reached: 1 });
    expect(h.written.map((d) => d.recipientUserId)).toEqual(['p1']);
  });

  it('a member affected in BOTH worlds gets one message per world, not one total', async () => {
    // Different types, different branding, different bells — deduplication is
    // per (recipient, world), which is what "one notification per distinct
    // counterparty" means in a two-app collection.
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 1);
    targets.studyFamilies.set('fam1', 2);
    await notifyErasureCounterparties('erased', targets, 'X Y', NOW);
    const forP1 = h.written.filter((d) => d.recipientUserId === 'p1');
    expect(forP1.map((d) => d.type).sort()).toEqual(['account_deleted', 'study_account_deleted']);
  });

  it('empty targets: nothing sent, nothing thrown', async () => {
    expect(
      await notifyErasureCounterparties('erased', emptyCounterpartyTargets(), 'X Y', NOW),
    ).toEqual({ found: 0, reached: 0 });
    expect(h.written).toHaveLength(0);
  });

  it('falls back to the role noun when the erased account had no name', async () => {
    const targets = emptyCounterpartyTargets();
    targets.sitFamilies.set('fam1', 1);
    targets.studyTutors.set('tutor1', 1);
    await notifyErasureCounterparties('erased', targets, '', NOW);
    const byUid = new Map(h.written.map((d) => [d.recipientUserId, d]));
    expect(byUid.get('p1')!.body).toContain('Your babysitter is no longer');
    expect(byUid.get('tutor1')!.body).toContain('A family you worked with is no longer');
  });
});
