import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for the invite-claim lease (issue: co-parent links were single-use
// by policy but not under concurrency).
//
// WHY THESE ARE WIRING PINS AND NOT A RACE. Exclusion here is by construction:
// Firestore serializes transactions contending on one document. The emulator
// suite cannot deterministically race two redemptions — verified directly, by
// making the claim a plain read-then-write and watching the whole integration
// suite, concurrency test included, stay green. A behavioural test therefore
// cannot tell the two apart, so these lock the wiring instead: every step
// reads with tx.get and writes with tx.update, never ref.get / ref.update.
// (Same reasoning, same shape as auth/__tests__/sendRateLimitTx.test.ts.)

const h = vi.hoisted(() => ({
  doc: undefined as Record<string, unknown> | undefined,
  runTransactionCalls: 0,
  txGets: [] as string[],
  txUpdates: [] as Record<string, unknown>[],
  directGets: 0,
  directUpdates: 0,
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: () => ({
      doc: (id: string) => ({
        id,
        get: async () => {
          h.directGets += 1;
          return { exists: h.doc !== undefined, data: () => h.doc };
        },
        update: async () => {
          h.directUpdates += 1;
        },
      }),
    }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      h.runTransactionCalls += 1;
      const tx = {
        get: async (ref: { id: string }) => {
          h.txGets.push(ref.id);
          return { exists: h.doc !== undefined, data: () => h.doc };
        },
        update: (ref: { id: string }, data: Record<string, unknown>) => {
          h.txUpdates.push({ __ref: ref.id, ...data });
        },
      };
      return fn(tx);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: () => '__DELETE__',
    arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
  },
}));

const { claimInvite, consumeInviteClaimAndJoin, releaseInviteClaim, INVITE_CLAIM_TTL_MS, newClaimId } =
  await import('../inviteClaim.js');

const REF = { id: 'tok-1' } as unknown as FirebaseFirestore.DocumentReference;
const FAMILY_REF = { id: 'fam-1' } as unknown as FirebaseFirestore.DocumentReference;
const NOW = new Date('2027-03-01T12:00:00.000Z');
const ts = (d: Date) => ({ toDate: () => d });

function invite(over: Record<string, unknown> = {}) {
  return {
    familyId: 'fam-1',
    used: false,
    expiresAt: ts(new Date(NOW.getTime() + 86_400_000)),
    ...over,
  };
}

beforeEach(() => {
  h.doc = invite();
  h.runTransactionCalls = 0;
  h.txGets = [];
  h.txUpdates = [];
  h.directGets = 0;
  h.directUpdates = 0;
});

describe('claimInvite', () => {
  it('reads AND writes inside ONE transaction — never a bare ref.get/ref.update', async () => {
    // The pin that a plain read-then-write cannot satisfy. Check-then-act on
    // this doc is the whole defect; only a transaction excludes the twin.
    const familyId = await claimInvite(REF, 'claim-A', NOW);

    expect(familyId).toBe('fam-1');
    expect(h.runTransactionCalls).toBe(1);
    expect(h.txGets).toEqual(['tok-1']);
    expect(h.txUpdates).toEqual([{ __ref: 'tok-1', claimedAt: NOW, claimId: 'claim-A' }]);
    expect(h.directGets).toBe(0);
    expect(h.directUpdates).toBe(0);
  });

  it('refuses a link already consumed, writing nothing', async () => {
    h.doc = invite({ used: true });
    await expect(claimInvite(REF, 'claim-A', NOW)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(h.txUpdates).toEqual([]);
  });

  it('refuses a link whose claim is still LIVE, writing nothing', async () => {
    h.doc = invite({
      claimedAt: ts(new Date(NOW.getTime() - (INVITE_CLAIM_TTL_MS - 1000))),
      claimId: 'someone-else',
    });
    await expect(claimInvite(REF, 'claim-A', NOW)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(h.txUpdates).toEqual([]);
  });

  it('TAKES a link whose claim has gone stale — a dead invocation cannot burn it', async () => {
    h.doc = invite({
      claimedAt: ts(new Date(NOW.getTime() - (INVITE_CLAIM_TTL_MS + 1000))),
      claimId: 'dead-invocation',
    });
    await expect(claimInvite(REF, 'claim-A', NOW)).resolves.toBe('fam-1');
    expect(h.txUpdates).toEqual([{ __ref: 'tok-1', claimedAt: NOW, claimId: 'claim-A' }]);
  });

  it('refuses a missing link and an expired one', async () => {
    h.doc = undefined;
    await expect(claimInvite(REF, 'c', NOW)).rejects.toMatchObject({ code: 'not-found' });
    h.doc = invite({ expiresAt: ts(new Date(NOW.getTime() - 1000)) });
    await expect(claimInvite(REF, 'c', NOW)).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
  });
});

describe('consumeInviteClaimAndJoin', () => {
  it('burns the link AND joins the family in ONE transaction', async () => {
    // The membership write lives here, not beside the call, precisely so a
    // stolen claim cannot leave a join already committed (PR #533 review).
    h.doc = invite({ claimedAt: ts(NOW), claimId: 'claim-A' });
    await consumeInviteClaimAndJoin(REF, 'claim-A', 'uid-1', FAMILY_REF, NOW);

    expect(h.runTransactionCalls).toBe(1);
    expect(h.txGets).toEqual(['tok-1']);
    expect(h.txUpdates).toEqual([
      { __ref: 'fam-1', parentIds: { __arrayUnion: ['uid-1'] }, updatedAt: NOW },
      {
        __ref: 'tok-1',
        used: true,
        usedByUserId: 'uid-1',
        claimedAt: '__DELETE__',
        claimId: '__DELETE__',
      },
    ]);
    expect(h.directUpdates).toBe(0);
  });

  it('a link claimed by SOMEONE ELSE grants NO membership at all', async () => {
    // The regression this shape exists to prevent: the old ordering joined the
    // family first and discovered the stolen claim second, so both redemptions
    // landed in parentIds. Nothing may be written now.
    h.doc = invite({ claimedAt: ts(NOW), claimId: 'claim-B' });
    await expect(
      consumeInviteClaimAndJoin(REF, 'claim-A', 'uid-1', FAMILY_REF, NOW),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(h.txUpdates).toEqual([]);
    expect(h.directUpdates).toBe(0);
  });
});

describe('releaseInviteClaim', () => {
  it('clears OUR lease so the link is immediately reusable', async () => {
    h.doc = invite({ claimedAt: ts(NOW), claimId: 'claim-A' });
    await releaseInviteClaim(REF, 'claim-A');
    expect(h.txUpdates).toEqual([
      { __ref: 'tok-1', claimedAt: '__DELETE__', claimId: '__DELETE__' },
    ]);
  });

  it('never clears a lease belonging to another redemption', async () => {
    // An unconditional release would hand the link to a third party in exactly
    // the case the lease exists to prevent.
    h.doc = invite({ claimedAt: ts(NOW), claimId: 'claim-B' });
    await releaseInviteClaim(REF, 'claim-A');
    expect(h.txUpdates).toEqual([]);
  });

  it('swallows a failed release — the TTL is the backstop, not the caller error', async () => {
    h.doc = undefined;
    await expect(releaseInviteClaim(REF, 'claim-A')).resolves.toBeUndefined();
  });
});

describe('newClaimId', () => {
  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 50 }, newClaimId)).size).toBe(50);
  });
});
