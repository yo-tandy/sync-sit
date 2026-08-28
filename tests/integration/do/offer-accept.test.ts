import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
  parisDateFromNow,
  PROJECT_ID,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// PR6 acceptance (plan §6.4, §14): the one transaction that matters —
// end-to-end post→offer→accept through the real callables, the sibling
// flips (pending → declined/sibling_accepted, pending_guardian → EXPIRED,
// never declined), offerCount → 0 inside the winning transaction, and the
// concurrency pin: two parents accepting two different offers — exactly one
// wins.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRESTORE_PORT = process.env.TEST_FIRESTORE_PORT ?? '8080';

async function clientReadStatus(path: string, idToken: string): Promise<number> {
  const res = await fetch(
    `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  return res.status;
}

function dobYearsAgo(years: number): Date {
  return new Date(Date.now() - years * 365.25 * DAY_MS - 40 * DAY_MS);
}

async function seedDoer(uid: string, opts: { age?: number; governedFamilyId?: string } = {}) {
  const db = getDb();
  await getAdminAuth().createUser({ uid, email: `${uid}@ejm.org` });
  await db.collection('users').doc(uid).set({
    uid,
    email: `${uid}@ejm.org`,
    status: 'active',
    firstName: `First-${uid}`,
    lastName: `Last-${uid}`,
    dateOfBirth: dobYearsAgo(opts.age ?? 17),
    ...(opts.governedFamilyId
      ? { governedBy: { familyId: opts.governedFamilyId, linkedAt: new Date() } }
      : {}),
    profiles: {
      doer: {
        enrollmentComplete: true, notifyNewTasks: true,
        categories: ['green_thumb'], bio: null, defaultRate: null,
        hasCar: false, hasBike: false,
      },
    },
    notifPrefs: {}, fcmTokens: [],
    createdAt: new Date(), updatedAt: new Date(),
  });
  if (opts.governedFamilyId) {
    await db.collection('guardianLinks').doc(uid).set({
      childUid: uid,
      familyId: opts.governedFamilyId,
      createdByParentUid: 'seed-parent',
      status: 'active',
      origin: 'parent_created',
      requestedAt: new Date(),
      confirmedAt: new Date(),
    });
  }
}

/** Post a FLAGGED-sub-category task through the real callable, so the
 *  governed doer's offer lands in pending_guardian on it. */
async function postFlaggedTask(parentToken: string): Promise<string> {
  const { taskId } = await callFunction<{ taskId: string }>('doPostTask', {
    category: 'green_thumb',
    subCategory: 'green_thumb_lawn_mowing',
    title: 'Mow the lawn weekly',
    description: 'Small garden, mower provided.',
    photos: [],
    timing: 'ongoing',
    startDate: parisDateFromNow(1),
    cadence: { kind: 'weekly', days: ['sat'] },
    adultPresent: 'partly',
    toolsProvided: true,
    transportNeeded: false,
  }, parentToken);
  return taskId;
}

function offerPayload(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    taskId,
    price: 25,
    priceBasis: 'flat',
    message: 'Happy to help.',
    ...overrides,
  };
}

describe('doAcceptOffer — the §6.4 transaction', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent2Token: string; // co-parent, same family — the concurrency pair
  let parent3Token: string; // unrelated family
  let doer1Token: string;
  let doer2Token: string;
  let kidToken: string; // governed → pending_guardian on flagged tasks

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016', city: 'Paris',
    });
    await seedDoer('doer-acc-1');
    await seedDoer('doer-acc-2');
    await seedDoer('doer-acc-kid', { age: 14, governedFamilyId: 'family-martin' });
    parent1Token = await getIdToken(seed.parent1.uid);
    parent2Token = await getIdToken(seed.parent2.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    doer1Token = await getIdToken('doer-acc-1');
    doer2Token = await getIdToken('doer-acc-2');
    kidToken = await getIdToken('doer-acc-kid');
  });

  afterAll(async () => {
    await clearAll();
  });

  it('END-TO-END post→offer→accept: winner accepted, pending sibling → declined/sibling_accepted, pending_guardian sibling → EXPIRED and family-unreadable, offerCount → 0', async () => {
    const taskId = await postFlaggedTask(parent1Token);

    const { offerId: winnerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 30 }), doer1Token,
    );
    const { offerId: loserId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 20 }), doer2Token,
    );
    const { offerId: gatedId, status: gatedStatus } = await callFunction<{ offerId: string; status: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 15 }), kidToken,
    );
    expect(gatedStatus).toBe('pending_guardian');
    let task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
    expect(task.offerCount).toBe(3);

    const result = await callFunction<{ taskId: string; offerId: string; agreedPrice: number }>(
      'doAcceptOffer', { offerId: winnerId }, parent1Token,
    );
    expect(result.taskId).toBe(taskId);
    expect(result.agreedPrice).toBe(30);

    // Step 6: the task, in the same transaction.
    task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
    expect(task.status).toBe('assigned');
    expect(task.assignedUserId).toBe('doer-acc-1');
    expect(task.assignedOfferId).toBe(winnerId);
    expect(task.assignedAt).not.toBeNull();
    expect(task.agreedPrice).toBe(30);
    expect(task.offerCount).toBe(0); // the fourth decrement path lands at ZERO

    // Step 7: the winner.
    const winner = (await getDb().collection('taskOffers').doc(winnerId).get()).data()!;
    expect(winner.status).toBe('accepted');

    // Step 8, pending half: sibling → declined / sibling_accepted.
    const loser = (await getDb().collection('taskOffers').doc(loserId).get()).data()!;
    expect(loser.status).toBe('declined');
    expect(loser.declinedReason).toBe('sibling_accepted');

    // Step 8, pending_guardian half: → EXPIRED, never declined — declined
    // is in the family's §7.2 allow-list, and accept-then-read must not
    // flush an offer the parent never approved.
    const gated = (await getDb().collection('taskOffers').doc(gatedId).get()).data()!;
    expect(gated.status).toBe('expired');
    expect(gated.declinedReason).toBeNull();
    // ...and it stays FAMILY-UNREADABLE through the rules' eye.
    expect(await clientReadStatus(`taskOffers/${gatedId}`, parent1Token)).toBe(403);
    // (While the flipped pending sibling IS readable — the contrast pin.)
    expect(await clientReadStatus(`taskOffers/${loserId}`, parent1Token)).toBe(200);

    // A second accept of the flipped sibling refuses: the task is gone.
    await expect(callFunction('doAcceptOffer', { offerId: loserId }, parent1Token))
      .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'task_not_open' } });
  });

  it('refusals: wrong family, pending_guardian target, banned student, expired task', async () => {
    const taskId = await postFlaggedTask(parent1Token);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), doer1Token,
    );
    const { offerId: gatedId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), kidToken,
    );

    // Step 3: only the owner family.
    await expect(callFunction('doAcceptOffer', { offerId }, parent3Token))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(callFunction('doAcceptOffer', { offerId }, doer1Token))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Step 2: an undecided guardian-gated offer is unacceptable.
    await expect(callFunction('doAcceptOffer', { offerId: gatedId }, parent1Token))
      .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_pending' } });

    // Step 4: a banned student between offer and acceptance.
    await getDb().collection('users').doc('doer-acc-1').update({ status: 'blocked' });
    await expect(callFunction('doAcceptOffer', { offerId }, parent1Token))
      .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'doer_unavailable' } });
    await getDb().collection('users').doc('doer-acc-1').update({ status: 'active' });

    // Step 1: an expired-but-unswept task refuses.
    await getDb().collection('doTasks').doc(taskId).update({
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    await expect(callFunction('doAcceptOffer', { offerId }, parent1Token))
      .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'task_expired' } });

    // Cleanup so later suites see a clean slate.
    await callFunction('doCancelTask', { taskId }, parent1Token);
  });

  it('CONCURRENT accepts of two DIFFERENT offers: exactly one wins, offerCount lands 0 in the winning transaction', async () => {
    const taskId = await postFlaggedTask(parent2Token);
    const { offerId: offerA } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 30 }), doer1Token,
    );
    const { offerId: offerB } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 20 }), doer2Token,
    );

    // The §6.4 rationale verbatim: "a second parent accepting a different
    // offer concurrently must lose." Marie and Pierre race.
    const [resA, resB] = await Promise.allSettled([
      callFunction('doAcceptOffer', { offerId: offerA }, parent1Token),
      callFunction('doAcceptOffer', { offerId: offerB }, parent2Token),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1); // exactly one winner
    expect(rejected).toHaveLength(1);
    // The loser lost on the task's state, not on some internal error: its
    // transaction retried against the winner's commit and found the task
    // no longer open (or the offer already flipped by the sibling sweep).
    const loserErr = (rejected[0] as PromiseRejectedResult).reason as { code: string };
    expect(loserErr.code).toBe('FAILED_PRECONDITION');

    const winnerOfferId =
      (fulfilled[0] as PromiseFulfilledResult<{ offerId: string }>).value.offerId;
    const loserOfferId = winnerOfferId === offerA ? offerB : offerA;

    const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
    expect(task.status).toBe('assigned');
    expect(task.assignedOfferId).toBe(winnerOfferId);
    // offerCount landed at 0 INSIDE the winning transaction — there is no
    // later write that could have zeroed it (decline/withdraw were never
    // called on this task).
    expect(task.offerCount).toBe(0);

    const winner = (await getDb().collection('taskOffers').doc(winnerOfferId).get()).data()!;
    expect(winner.status).toBe('accepted');
    const loser = (await getDb().collection('taskOffers').doc(loserOfferId).get()).data()!;
    expect(loser.status).toBe('declined');
    expect(loser.declinedReason).toBe('sibling_accepted');
    // Exactly one accepted offer exists on the task.
    const accepted = await getDb().collection('taskOffers')
      .where('taskId', '==', taskId).where('status', '==', 'accepted').get();
    expect(accepted.size).toBe(1);
  });
});
