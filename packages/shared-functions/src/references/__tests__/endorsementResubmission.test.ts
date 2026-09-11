import { describe, it, expect } from 'vitest';
import { checkEndorsementResubmission } from '../endorsementResubmission.js';
import { ENDORSEMENT_RESUBMISSION_COOLDOWN_MS } from '@ejm/shared-core';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A minimal Firestore-shaped fake: `.collection().where().where().where()`
 * returns a query object recording every filter it accumulated, and `.get()`
 * resolves to the docs handed to `fakeDb`. Enough to pin the query SHAPE
 * (three equality filters, no orderBy — the "no composite index" contract
 * the module header documents) without a live emulator; the actual Firestore
 * wiring is exercised end-to-end by the integration suite
 * (tests/integration/references/submit-tutor-endorsement.test.ts and
 * tests/integration/do/endorsements.test.ts).
 */
function fakeDb(docs: Record<string, unknown>[]) {
  const filters: { field: string; op: string; value: unknown }[] = [];
  const query = {
    where(field: string, op: string, value: unknown) {
      filters.push({ field, op, value });
      return query;
    },
    async get() {
      return { docs: docs.map((data) => ({ data: () => data })) };
    },
  };
  const db = {
    collection: (name: string) => {
      filters.push({ field: '__collection__', op: '==', value: name });
      return query;
    },
  } as unknown as FirebaseFirestore.Firestore;
  return { db, filters, query };
}

describe('checkEndorsementResubmission', () => {
  it('queries the shared collection with exactly the three equality filters, no orderBy', async () => {
    const { db, filters } = fakeDb([]);
    await checkEndorsementResubmission(db, {
      appSource: 'study',
      subjectField: 'tutorUserId',
      subjectUserId: 'tutor-1',
      familyId: 'family-1',
    });
    expect(filters).toEqual([
      { field: '__collection__', op: '==', value: 'references' },
      { field: 'appSource', op: '==', value: 'study' },
      { field: 'tutorUserId', op: '==', value: 'tutor-1' },
      { field: 'submittedByFamilyId', op: '==', value: 'family-1' },
    ]);
  });

  it('allows when no existing docs match', async () => {
    const { db } = fakeDb([]);
    const result = await checkEndorsementResubmission(db, {
      appSource: 'do',
      subjectField: 'doerUserId',
      subjectUserId: 'doer-1',
      familyId: 'family-1',
    });
    expect(result).toEqual({ allowed: true });
  });

  it('blocks on a live status doc', async () => {
    const { db } = fakeDb([{ status: 'private', updatedAt: new Date() }]);
    const result = await checkEndorsementResubmission(db, {
      appSource: 'study',
      subjectField: 'tutorUserId',
      subjectUserId: 'tutor-1',
      familyId: 'family-1',
    });
    expect(result).toEqual({ allowed: false, reason: 'live' });
  });

  it('reads updatedAt through toDate() (a Firestore Timestamp shape)', async () => {
    const declinedAt = new Date(Date.now() - 10 * DAY_MS);
    const { db } = fakeDb([
      { status: 'removed', updatedAt: { toDate: () => declinedAt } },
    ]);
    const result = await checkEndorsementResubmission(db, {
      appSource: 'study',
      subjectField: 'tutorUserId',
      subjectUserId: 'tutor-1',
      familyId: 'family-1',
    });
    expect(result).toMatchObject({ allowed: false, reason: 'cooldown' });
    expect((result as { retryAt: Date }).retryAt.getTime()).toBe(
      declinedAt.getTime() + ENDORSEMENT_RESUBMISSION_COOLDOWN_MS,
    );
  });

  it('reads updatedAt through toMillis() when present', async () => {
    const declinedAtMs = Date.now() - 40 * DAY_MS;
    const { db } = fakeDb([
      { status: 'removed', updatedAt: { toMillis: () => declinedAtMs, toDate: () => new Date(0) } },
    ]);
    const result = await checkEndorsementResubmission(db, {
      appSource: 'do',
      subjectField: 'doerUserId',
      subjectUserId: 'doer-1',
      familyId: 'family-1',
    });
    // 40 days ago is past the 30-day cool-down.
    expect(result).toEqual({ allowed: true });
  });

  it('reads updatedAt as a plain Date (what doSubmitEndorsement writes)', async () => {
    const declinedAt = new Date(Date.now() - 40 * DAY_MS);
    const { db } = fakeDb([{ status: 'removed', updatedAt: declinedAt }]);
    const result = await checkEndorsementResubmission(db, {
      appSource: 'do',
      subjectField: 'doerUserId',
      subjectUserId: 'doer-1',
      familyId: 'family-1',
    });
    expect(result).toEqual({ allowed: true });
  });

  it('reads through a transaction when one is passed, not the plain query', async () => {
    const declinedAt = new Date(Date.now() - 10 * DAY_MS);
    const { db, query } = fakeDb([{ status: 'removed', updatedAt: declinedAt }]);
    let txGetCalledWith: unknown = null;
    const tx = {
      get: async (q: unknown) => {
        txGetCalledWith = q;
        return (q as { get: () => Promise<unknown> }).get
          ? await (q as typeof query).get()
          : { docs: [] };
      },
    } as unknown as FirebaseFirestore.Transaction;

    const result = await checkEndorsementResubmission(
      db,
      { appSource: 'do', subjectField: 'doerUserId', subjectUserId: 'doer-1', familyId: 'family-1' },
      { tx },
    );
    expect(txGetCalledWith).toBe(query);
    expect(result).toMatchObject({ reason: 'cooldown' });
  });

  it('accepts an injected `now` for deterministic boundary testing', async () => {
    const declinedAt = new Date('2026-01-01T00:00:00.000Z');
    const { db } = fakeDb([{ status: 'removed', updatedAt: declinedAt }]);
    const exactlyAtBoundary = new Date(declinedAt.getTime() + ENDORSEMENT_RESUBMISSION_COOLDOWN_MS);
    const result = await checkEndorsementResubmission(
      db,
      { appSource: 'study', subjectField: 'tutorUserId', subjectUserId: 't1', familyId: 'f1' },
      { now: exactlyAtBoundary },
    );
    expect(result).toEqual({ allowed: true });
  });
});
