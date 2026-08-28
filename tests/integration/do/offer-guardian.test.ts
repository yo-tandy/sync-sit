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

// PR6 guardian decision (plan §6.2, §8, §14): doDecideOfferAsGuardian —
// approve → pending, deny → withdrawn, and BOTH halves of the invisibility
// promise asserted through the rules' eye as the hiring family.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRESTORE_PORT = process.env.TEST_FIRESTORE_PORT ?? '8080';

async function clientReadStatus(path: string, idToken: string): Promise<number> {
  const res = await fetch(
    `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  return res.status;
}

const KID_UID = 'guardian-kid-14';
const FLAGGED_SUB = 'green_thumb_lawn_mowing';

/** The governed kid: supervised by family2 (Martin, parent3). The HIRING
 *  family is family1 (Dupont) — supervising ≠ hiring, so the rules-eye
 *  denials below prove the §6.2 boundary, not a coincidence of families. */
async function seedGovernedKid(seed: SeedData) {
  const db = getDb();
  await getAdminAuth().createUser({ uid: KID_UID, email: `${KID_UID}@ejm.org` });
  await db.collection('users').doc(KID_UID).set({
    uid: KID_UID,
    email: `${KID_UID}@ejm.org`,
    status: 'active',
    firstName: 'Kim',
    lastName: 'Kid',
    dateOfBirth: new Date(Date.now() - 14 * 365.25 * DAY_MS - 40 * DAY_MS),
    governedBy: { familyId: seed.parent3.familyId, linkedAt: new Date() },
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
  await db.collection('guardianLinks').doc(KID_UID).set({
    childUid: KID_UID,
    familyId: seed.parent3.familyId,
    createdByParentUid: seed.parent3.uid,
    status: 'active',
    origin: 'parent_created',
    requestedAt: new Date(),
    confirmedAt: new Date(),
  });
}

async function seedFlaggedTask(taskId: string, familyId: string) {
  const now = new Date();
  await getDb().collection('doTasks').doc(taskId).set({
    taskId, familyId, createdByUserId: 'seed-parent',
    familyName: 'Dupont', areaLabel: '16e',
    category: 'green_thumb', subCategory: FLAGGED_SUB,
    title: `Task ${taskId}`, description: 'Mow the lawn.',
    photos: [],
    timing: 'ongoing', date: null, startTime: null, endTime: null, dueDate: null,
    startDate: parisDateFromNow(1), endDate: null,
    cadence: { kind: 'weekly', days: ['sat'] },
    estimatedHours: null, suggestedBudget: null,
    adultPresent: 'no', toolsProvided: null, transportNeeded: false,
    status: 'open', offerCount: 0,
    assignedUserId: null, assignedOfferId: null, assignedAt: null,
    agreedPrice: null, doerMarkedDoneAt: null, completedAt: null,
    cancelledAt: null, cancelledBy: null,
    createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + 10 * DAY_MS),
  });
}

describe('doDecideOfferAsGuardian (§6.2)', () => {
  let seed: SeedData;
  let kidToken: string;
  let guardianToken: string; // parent3 — the supervising parent (Martin)
  let hiringToken: string; // parent1 — the hiring family (Dupont)

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await seedGovernedKid(seed);
    kidToken = await getIdToken(KID_UID);
    guardianToken = await getIdToken(seed.parent3.uid);
    hiringToken = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('APPROVE: pending_guardian → pending, offerCount untouched, decision recorded, family can now read', async () => {
    await seedFlaggedTask('t-g-approve', seed.family1Id);
    const { offerId, status } = await callFunction<{ offerId: string; status: string }>(
      'doSubmitOffer',
      { taskId: 't-g-approve', price: 20, priceBasis: 'flat', message: 'I can mow.' },
      kidToken,
    );
    expect(status).toBe('pending_guardian');
    // Pre-decision: invisible to the hiring family, readable by the
    // SUPERVISING family (its §7.2 disjunct).
    expect(await clientReadStatus(`taskOffers/${offerId}`, hiringToken)).toBe(403);
    expect(await clientReadStatus(`taskOffers/${offerId}`, guardianToken)).toBe(200);

    const result = await callFunction<{ status: string }>(
      'doDecideOfferAsGuardian', { offerId, decision: 'approve' }, guardianToken,
    );
    expect(result.status).toBe('pending');

    const offer = (await getDb().collection('taskOffers').doc(offerId).get()).data()!;
    expect(offer.status).toBe('pending');
    expect(offer.guardian.decidedByUid).toBe(seed.parent3.uid);
    expect(offer.guardian.decidedAt).not.toBeNull();
    // Approval keeps the offer LIVE: the count does not move.
    const task = (await getDb().collection('doTasks').doc('t-g-approve').get()).data()!;
    expect(task.offerCount).toBe(1);
    // The family sees it now (pending is in their allow-list).
    expect(await clientReadStatus(`taskOffers/${offerId}`, hiringToken)).toBe(200);

    // A decided offer cannot be decided again.
    await expect(callFunction('doDecideOfferAsGuardian', { offerId, decision: 'deny' }, guardianToken))
      .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_pending_guardian' } });
  });

  it('DENY: pending_guardian → WITHDRAWN — indistinguishable from self-withdrawal, family-invisible, slot returned', async () => {
    await seedFlaggedTask('t-g-deny', seed.family1Id);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer',
      { taskId: 't-g-deny', price: 20, priceBasis: 'flat', message: 'I can mow.' },
      kidToken,
    );

    const result = await callFunction<{ status: string }>(
      'doDecideOfferAsGuardian', { offerId, decision: 'deny' }, guardianToken,
    );
    expect(result.status).toBe('withdrawn');

    const offer = (await getDb().collection('taskOffers').doc(offerId).get()).data()!;
    // §6.2: denial lands in the SAME status the student's own withdraw
    // writes — never a declined variant the family could read.
    expect(offer.status).toBe('withdrawn');
    expect(offer.guardian.decidedByUid).toBe(seed.parent3.uid);
    // The §6.2 invisibility promise, post-decision half: the hiring
    // family's rules-eye read stays DENIED — they never learn the offer
    // existed, let alone that a parent refused it.
    expect(await clientReadStatus(`taskOffers/${offerId}`, hiringToken)).toBe(403);
    // The offer left the live set: slot returned.
    const task = (await getDb().collection('doTasks').doc('t-g-deny').get()).data()!;
    expect(task.offerCount).toBe(0);
    // The student can re-offer — and the resurrection re-gates.
    const again = await callFunction<{ status: string }>(
      'doSubmitOffer',
      { taskId: 't-g-deny', price: 25, priceBasis: 'flat', message: 'Please?' },
      kidToken,
    );
    expect(again.status).toBe('pending_guardian');
  });

  it('refuses everyone who is not the supervising parent — one indistinguishable refusal', async () => {
    await seedFlaggedTask('t-g-auth', seed.family1Id);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer',
      { taskId: 't-g-auth', price: 20, priceBasis: 'flat', message: 'I can mow.' },
      kidToken,
    );
    // The HIRING family's parent is not the guardian.
    await expect(callFunction('doDecideOfferAsGuardian', { offerId, decision: 'approve' }, hiringToken))
      .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { code: 'guardian/not-supervised' } });
    // The student cannot approve their own offer (not a family parent).
    await expect(callFunction('doDecideOfferAsGuardian', { offerId, decision: 'approve' }, kidToken))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // Unauthenticated.
    await expect(callFunction('doDecideOfferAsGuardian', { offerId, decision: 'approve' }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // Junk decision value.
    await expect(callFunction('doDecideOfferAsGuardian', { offerId, decision: 'maybe' }, guardianToken))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('a REVOKED link no longer grants the decision power', async () => {
    await seedFlaggedTask('t-g-revoked', seed.family1Id);
    const { offerId } = await callFunction<{ offerId: string }>(
      'doSubmitOffer',
      { taskId: 't-g-revoked', price: 20, priceBasis: 'flat', message: 'I can mow.' },
      kidToken,
    );
    await getDb().collection('guardianLinks').doc(KID_UID).update({ status: 'revoked' });
    try {
      await expect(callFunction('doDecideOfferAsGuardian', { offerId, decision: 'approve' }, guardianToken))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { code: 'guardian/not-supervised' } });
    } finally {
      await getDb().collection('guardianLinks').doc(KID_UID).update({ status: 'active' });
    }
  });
});
