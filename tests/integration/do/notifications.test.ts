import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
  parisDateFromNow,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// PR9 notification wiring (plan §10, §13): every call site writes the right
// NotificationDoc for the right audience. Emails/pushes are exercised
// through the emulator's [DEV]/no-token paths; the payload copy itself is
// pinned in apps/functions/src/do/__tests__/notifyContent.test.ts, and the
// branding tables in shared-functions' unit suites. Here the pins are the
// AUDIENCE and TYPE of each notification — §6.2's invisibility included:
// the hiring family must never receive (or be mentioned in) anything about
// an undecided or denied guardian-gated offer.

const DAY_MS = 24 * 60 * 60 * 1000;

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
    language: 'en',
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

/** Post a task through the real callable. Default sub-category is UNFLAGGED
 *  (garden watering); pass the flagged mowing one for guardian-gate flows. */
async function postTask(
  parentToken: string,
  subCategory = 'green_thumb_garden_watering',
): Promise<string> {
  const { taskId } = await callFunction<{ taskId: string }>('doPostTask', {
    category: 'green_thumb',
    subCategory,
    title: 'Water the terrace plants',
    description: 'Two dozen pots, watering can provided.',
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

async function notifsFor(recipientUid: string, type?: string) {
  let q = getDb()
    .collection('notifications')
    .where('recipientUserId', '==', recipientUid);
  if (type) q = q.where('type', '==', type);
  return (await q.get()).docs.map((d) => d.data());
}

async function clearNotifs() {
  const snap = await getDb().collection('notifications').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe('sync-do call-site notifications (plan §10, §13 PR9)', () => {
  let seed: SeedData;
  let parent1Token: string;
  let doer1Token: string;
  let doer2Token: string;
  let kidToken: string; // governed by family-martin (parent3's family)

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016', city: 'Paris',
    });
    await seedDoer('doer-ntf-1');
    await seedDoer('doer-ntf-2');
    await seedDoer('doer-ntf-kid', { age: 14, governedFamilyId: 'family-martin' });
    parent1Token = await getIdToken(seed.parent1.uid);
    doer1Token = await getIdToken('doer-ntf-1');
    doer2Token = await getIdToken('doer-ntf-2');
    kidToken = await getIdToken('doer-ntf-kid');
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    await clearNotifs();
    // Each test posts fresh tasks; drop the previous test's so the
    // DO_TASK_MAX_ACTIVE (5 open per family) ceiling never trips.
    const db = getDb();
    for (const coll of ['doTasks', 'taskOffers']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  });

  it('doSubmitOffer (pending): every parent of the hiring family gets task_offer_received', async () => {
    const taskId = await postTask(parent1Token);
    await clearNotifs(); // drop any posting-time noise
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), doer1Token,
    );

    for (const parentUid of [seed.parent1.uid, seed.parent2.uid]) {
      const notifs = await notifsFor(parentUid, 'task_offer_received');
      expect(notifs).toHaveLength(1);
      expect(notifs[0].data).toMatchObject({ taskId, offerId });
      expect(notifs[0].body).toContain('First-doer-ntf-1');
      expect(notifs[0].body).toContain('Water the terrace plants');
    }
    // The student themselves gets nothing on their own submit.
    expect(await notifsFor('doer-ntf-1')).toHaveLength(0);
  });

  it('doSubmitOffer (pending_guardian): the SUPERVISING parent is notified, the hiring family is NOT (§6.2)', async () => {
    const taskId = await postTask(parent1Token, 'green_thumb_lawn_mowing');
    await clearNotifs();
    const { status } = await callFunction<{ status: string }>(
      'doSubmitOffer', offerPayload(taskId), kidToken,
    );
    expect(status).toBe('pending_guardian');

    // Supervising parent (family-martin → parent3): approval request.
    const guardianNotifs = await notifsFor(seed.parent3.uid, 'task_guardian_approval');
    expect(guardianNotifs).toHaveLength(1);
    expect(guardianNotifs[0].body).toContain('First-doer-ntf-kid');

    // Hiring family: NOTHING — the offer does not exist for them yet.
    expect(await notifsFor(seed.parent1.uid)).toHaveLength(0);
    expect(await notifsFor(seed.parent2.uid)).toHaveLength(0);
  });

  it('doDecideOfferAsGuardian DENY: the student is told a parent acted; the hiring family learns NOTHING (§6.2)', async () => {
    const taskId = await postTask(parent1Token, 'green_thumb_lawn_mowing');
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), kidToken,
    );
    await clearNotifs();

    const parent3Token = await getIdToken(seed.parent3.uid);
    await callFunction('doDecideOfferAsGuardian', { offerId, decision: 'deny' }, parent3Token);

    const childNotifs = await notifsFor('doer-ntf-kid', 'task_guardian_approval');
    expect(childNotifs).toHaveLength(1);
    expect(childNotifs[0].data).toMatchObject({ decision: 'denied' });

    // The §6.2 invisibility promise, post-decision half: the hiring family
    // must never learn a guardian said no — no notification of ANY type.
    expect(await notifsFor(seed.parent1.uid)).toHaveLength(0);
    expect(await notifsFor(seed.parent2.uid)).toHaveLength(0);
  });

  it('doDecideOfferAsGuardian APPROVE: the student is told, and the hiring family now sees task_offer_received', async () => {
    const taskId = await postTask(parent1Token, 'green_thumb_lawn_mowing');
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), kidToken,
    );
    await clearNotifs();

    const parent3Token = await getIdToken(seed.parent3.uid);
    await callFunction('doDecideOfferAsGuardian', { offerId, decision: 'approve' }, parent3Token);

    const childNotifs = await notifsFor('doer-ntf-kid', 'task_guardian_approval');
    expect(childNotifs).toHaveLength(1);
    expect(childNotifs[0].data).toMatchObject({ decision: 'approved' });

    const familyNotifs = await notifsFor(seed.parent1.uid, 'task_offer_received');
    expect(familyNotifs).toHaveLength(1);
    expect(familyNotifs[0].data).toMatchObject({ taskId, offerId });
  });

  it('doAcceptOffer: winner gets task_offer_accepted, each loser task_offer_declined, the winner\'s guardian task_assigned — and the expired pending_guardian sibling\'s doer gets nothing', async () => {
    const taskId = await postTask(parent1Token, 'green_thumb_lawn_mowing');
    // Winner is the GOVERNED kid — approve their offer first so it is
    // acceptable AND the guardian-notice path has a linked winner.
    const { offerId: kidOfferId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 30 }), kidToken,
    );
    const parent3Token = await getIdToken(seed.parent3.uid);
    await callFunction('doDecideOfferAsGuardian', { offerId: kidOfferId, decision: 'approve' }, parent3Token);
    const { offerId: loserId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 20 }), doer1Token,
    );
    // A second governed doer would need a second guardian family; the
    // expired-sibling case instead: doer2 submits then a guardian gate is
    // not involved — use a pending_guardian sibling from a NEW governed kid.
    await seedDoer('doer-ntf-kid2', { age: 14, governedFamilyId: 'family-martin' });
    const kid2Token = await getIdToken('doer-ntf-kid2');
    const { offerId: gatedId, status: gatedStatus } = await callFunction<{ offerId: string; status: string }>(
      'doSubmitOffer', offerPayload(taskId, { price: 15 }), kid2Token,
    );
    expect(gatedStatus).toBe('pending_guardian');
    await clearNotifs();

    await callFunction('doAcceptOffer', { offerId: kidOfferId }, parent1Token);

    // Winner.
    const winnerNotifs = await notifsFor('doer-ntf-kid', 'task_offer_accepted');
    expect(winnerNotifs).toHaveLength(1);
    expect(winnerNotifs[0].data).toMatchObject({ taskId, offerId: kidOfferId });

    // Loser (the declined pending sibling).
    const loserNotifs = await notifsFor('doer-ntf-1', 'task_offer_declined');
    expect(loserNotifs).toHaveLength(1);
    expect(loserNotifs[0].data).toMatchObject({ taskId });

    // Winner's guardian (active link → family-martin's parent).
    const guardianNotifs = await notifsFor(seed.parent3.uid, 'task_assigned');
    expect(guardianNotifs).toHaveLength(1);
    expect(guardianNotifs[0].body).toContain('First-doer-ntf-kid');

    // The EXPIRED pending_guardian sibling's doer: no notification — nobody
    // declined that offer; its moment passed (§6.4 step 8).
    expect(await notifsFor('doer-ntf-kid2')).toHaveLength(0);
    // Sanity: the sibling really did expire.
    const gated = (await getDb().collection('taskOffers').doc(gatedId).get()).data()!;
    expect(gated.status).toBe('expired');
    void loserId;
  });

  it('doDeclineOffer: the student gets task_offer_declined', async () => {
    const taskId = await postTask(parent1Token);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), doer1Token,
    );
    await clearNotifs();

    await callFunction('doDeclineOffer', { offerId }, parent1Token);

    const notifs = await notifsFor('doer-ntf-1', 'task_offer_declined');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].data).toMatchObject({ taskId, offerId });
    expect(notifs[0].body).toContain('Water the terrace plants');
  });

  it('doCancelTask (open): every swept offerer gets task_cancelled; the family gets nothing', async () => {
    const taskId = await postTask(parent1Token);
    await callFunction('doSubmitOffer', offerPayload(taskId), doer1Token);
    await callFunction('doSubmitOffer', offerPayload(taskId, { price: 18 }), doer2Token);
    await clearNotifs();

    await callFunction('doCancelTask', { taskId }, parent1Token);

    expect(await notifsFor('doer-ntf-1', 'task_cancelled')).toHaveLength(1);
    expect(await notifsFor('doer-ntf-2', 'task_cancelled')).toHaveLength(1);
    expect(await notifsFor(seed.parent1.uid)).toHaveLength(0);
    expect(await notifsFor(seed.parent2.uid)).toHaveLength(0);
  });

  it('doCancelTask (assigned, by family): the assigned doer gets task_cancelled', async () => {
    const taskId = await postTask(parent1Token);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), doer1Token,
    );
    await callFunction('doAcceptOffer', { offerId }, parent1Token);
    await clearNotifs();

    await callFunction('doCancelTask', { taskId }, parent1Token);

    expect(await notifsFor('doer-ntf-1', 'task_cancelled')).toHaveLength(1);
    expect(await notifsFor(seed.parent1.uid)).toHaveLength(0);
  });

  it('doCancelTask (assigned, by doer): the family gets task_cancelled naming the student', async () => {
    const taskId = await postTask(parent1Token);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), doer1Token,
    );
    await callFunction('doAcceptOffer', { offerId }, parent1Token);
    await clearNotifs();

    await callFunction('doCancelTask', { taskId }, doer1Token);

    const notifs = await notifsFor(seed.parent1.uid, 'task_cancelled');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].body).toContain('First-doer-ntf-1');
    expect(await notifsFor('doer-ntf-1')).toHaveLength(0);
  });

  it('doUpdateTask: live offerers get task_updated; the empty RENEW tap notifies nobody', async () => {
    const taskId = await postTask(parent1Token);
    await callFunction('doSubmitOffer', offerPayload(taskId), doer1Token);
    await clearNotifs();

    // A real edit → notify.
    await callFunction('doUpdateTask', { taskId, description: 'Now with a hose, not a can.' }, parent1Token);
    expect(await notifsFor('doer-ntf-1', 'task_updated')).toHaveLength(1);

    // The empty-payload renew tap (§6.3) → silent.
    await clearNotifs();
    await callFunction('doUpdateTask', { taskId }, parent1Token);
    expect(await notifsFor('doer-ntf-1')).toHaveLength(0);
  });

  it('doMarkTaskDone: the student\'s FIRST mark notifies the family once; the family\'s completion notifies the student', async () => {
    const taskId = await postTask(parent1Token);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer', offerPayload(taskId), doer1Token,
    );
    await callFunction('doAcceptOffer', { offerId }, parent1Token);
    await clearNotifs();

    // Student marks → family notified.
    await callFunction('doMarkTaskDone', { taskId }, doer1Token);
    expect(await notifsFor(seed.parent1.uid, 'task_marked_done')).toHaveLength(1);
    expect(await notifsFor(seed.parent2.uid, 'task_marked_done')).toHaveLength(1);

    // Idempotent re-mark → NO second notification.
    await callFunction('doMarkTaskDone', { taskId }, doer1Token);
    expect(await notifsFor(seed.parent1.uid, 'task_marked_done')).toHaveLength(1);

    // Family completes → student notified.
    await clearNotifs();
    await callFunction('doMarkTaskDone', { taskId }, parent1Token);
    const doerNotifs = await notifsFor('doer-ntf-1', 'task_marked_done');
    expect(doerNotifs).toHaveLength(1);
    expect(doerNotifs[0].body).toContain('Water the terrace plants');
    expect(await notifsFor(seed.parent1.uid)).toHaveLength(0);
  });
});
