import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// PR11 endorsements (plan decision 12 as revised, §9.1, §9.2, §13). The pins
// are the ones the surfaces depend on and nothing else proves:
//
//  - the ELIGIBILITY gate is a COMPLETED task this family assigned to this
//    doer — not an assigned one, not another family's, not another doer's;
//  - one endorsement per (family, doer), and the co-parent is covered by the
//    same rule (families endorse, parents do not endorse individually);
//  - the doc is written `private` with `appSource: 'do'`, so nothing renders
//    on an offer card until the doer accepts;
//  - only the named doer may respond, accept → `approved`, decline →
//    `removed`, and a second response is refused;
//  - the notification trio reaches the right audience;
//  - NO `profiles.doer.endorsementCount` is minted anywhere (the decision
//    recorded in respondToEndorsement.ts — a counter with no reader);
//  - GDPR: the doc leaves with the doer AND with the submitting family
//    (`REFERENCE_PROVIDER_KEYS` already lists `doerUserId`; this proves the
//    field is actually handled now that docs carry it).

const DAY_MS = 24 * 60 * 60 * 1000;

function dobYearsAgo(years: number): Date {
  return new Date(Date.now() - years * 365.25 * DAY_MS - 40 * DAY_MS);
}

async function seedDoer(uid: string) {
  await getAdminAuth().createUser({ uid, email: `${uid}@ejm.org` });
  await getDb().collection('users').doc(uid).set({
    uid,
    email: `${uid}@ejm.org`,
    status: 'active',
    firstName: `First-${uid}`,
    lastName: `Last-${uid}`,
    dateOfBirth: dobYearsAgo(17),
    language: 'en',
    profiles: {
      doer: {
        enrollmentComplete: true, notifyNewTasks: false,
        categories: ['ikea'], bio: null, defaultRate: null,
        hasCar: false, hasBike: true,
      },
    },
    notifPrefs: {}, fcmTokens: [],
    createdAt: new Date(), updatedAt: new Date(),
  });
}

async function seedTask(
  taskId: string,
  familyId: string,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date();
  await getDb().collection('doTasks').doc(taskId).set({
    taskId, familyId, createdByUserId: 'seed-parent',
    familyName: 'Dupont', areaLabel: '16e',
    category: 'ikea', subCategory: 'ikea_assembly',
    title: `Task ${taskId}`, description: 'Flat-pack, tools provided.',
    photos: [],
    timing: 'deadline', date: null, startTime: null, endTime: null,
    dueDate: '2026-09-15', startDate: null, endDate: null, cadence: null,
    estimatedHours: null, suggestedBudget: null,
    adultPresent: 'yes', toolsProvided: true, transportNeeded: false,
    status: 'completed', offerCount: 0,
    assignedUserId: null, assignedOfferId: null,
    assignedAt: now, agreedPrice: 40,
    doerMarkedDoneAt: now, completedAt: now, cancelledAt: null, cancelledBy: null,
    createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + 10 * DAY_MS),
    ...overrides,
  });
}

const GOOD_TEXT = 'Assembled two PAX wardrobes in an afternoon and cleaned up after.';

describe('sync-do endorsements', () => {
  let seed: SeedData;
  let parent1Token: string; // Dupont
  let parent2Token: string; // Dupont co-parent
  let parent3Token: string; // a DIFFERENT family
  let doerToken: string;
  let otherDoerToken: string;
  let adminToken: string; // exportUserData / deleteUser are admin callables

  const DOER = 'doer-endorse-1';
  const OTHER_DOER = 'doer-endorse-2';

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await seedDoer(DOER);
    await seedDoer(OTHER_DOER);
    parent1Token = await getIdToken(seed.parent1.uid);
    parent2Token = await getIdToken(seed.parent2.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    doerToken = await getIdToken(DOER);
    otherDoerToken = await getIdToken(OTHER_DOER);
    adminToken = await getIdToken(seed.admin.uid);
  });

  beforeEach(async () => {
    // Endorsements and tasks are re-seeded per test: dedup and status guards
    // both depend on there being exactly one of each.
    for (const coll of ['references', 'doTasks', 'notifications']) {
      const snap = await getDb().collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  });

  describe('doSubmitEndorsement — the eligibility gate', () => {
    it('accepts a family whose COMPLETED task was assigned to this doer, writing a private do endorsement', async () => {
      await seedTask('t-done', seed.family1Id, { assignedUserId: DOER });
      const res = await callFunction<{ referenceId: string }>(
        'doSubmitEndorsement',
        { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' },
        parent1Token,
      );
      const doc = await getDb().collection('references').doc(res.referenceId).get();
      const data = doc.data()!;
      expect(data).toMatchObject({
        doerUserId: DOER,
        appSource: 'do',
        type: 'family_submitted',
        status: 'private',
        submittedByUserId: seed.parent1.uid,
        submittedByFamilyId: seed.family1Id,
        referenceText: GOOD_TEXT,
        refName: 'Marie',
        // Server-derived from the qualifying task — never client input.
        category: 'ikea',
      });
      expect(data.submittedByName).toBe('Marie Dupont');
      // NOT babysitterUserId/tutorUserId: the sibling apps' surfaces must not
      // pick this doc up.
      expect(data.babysitterUserId).toBeUndefined();
      expect(data.tutorUserId).toBeUndefined();
    });

    it('refuses when the task is only ASSIGNED, not completed', async () => {
      await seedTask('t-assigned', seed.family1Id, {
        assignedUserId: DOER, status: 'assigned', completedAt: null,
      });
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'no_completed_task' } });
    });

    it('refuses when the completed task was assigned to a DIFFERENT doer', async () => {
      await seedTask('t-other-doer', seed.family1Id, { assignedUserId: OTHER_DOER });
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'no_completed_task' } });
    });

    it("refuses a DIFFERENT family — a completed task is not a platform-wide licence to endorse", async () => {
      await seedTask('t-fam1', seed.family1Id, { assignedUserId: DOER });
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Jean' }, parent3Token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'no_completed_task' } });
    });

    it('refuses a caller with no completed task at all', async () => {
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'no_completed_task' } });
    });

    it('copies the category from the MOST RECENTLY completed qualifying task', async () => {
      const older = new Date(Date.now() - 30 * DAY_MS);
      await seedTask('t-old', seed.family1Id, {
        assignedUserId: DOER, category: 'boxes', subCategory: 'boxes_packing', completedAt: older,
      });
      await seedTask('t-new', seed.family1Id, { assignedUserId: DOER, category: 'it', subCategory: 'it_setup' });
      const res = await callFunction<{ referenceId: string }>(
        'doSubmitEndorsement',
        { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' },
        parent1Token,
      );
      const data = (await getDb().collection('references').doc(res.referenceId).get()).data()!;
      expect(data.category).toBe('it');
    });
  });

  describe('doSubmitEndorsement — input and dedup', () => {
    beforeEach(async () => {
      await seedTask('t-done', seed.family1Id, { assignedUserId: DOER });
    });

    it('rejects unauthenticated callers and bad input before writing anything', async () => {
      await expect(callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'M' }))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      for (const bad of [
        { doerUserId: '', referenceText: GOOD_TEXT, refName: 'M' },
        { doerUserId: 'a/b', referenceText: GOOD_TEXT, refName: 'M' },
        { doerUserId: DOER, referenceText: 'too short', refName: 'M' },
        { doerUserId: DOER, referenceText: '          ', refName: 'M' },
        { doerUserId: DOER, referenceText: GOOD_TEXT, refName: '  ' },
      ]) {
        await expect(callFunction('doSubmitEndorsement', bad, parent1Token))
          .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      }
      expect((await getDb().collection('references').get()).size).toBe(0);
    });

    it('refuses self-endorsement', async () => {
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: seed.parent1.uid, referenceText: GOOD_TEXT, refName: 'M' }, parent1Token),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('refuses an unknown user', async () => {
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: 'nobody-at-all', referenceText: GOOD_TEXT, refName: 'M' }, parent1Token),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    // "Enrolled" means `enrollmentComplete`, the same thing it means at
    // §7.2's board read rule and §11.1's offering gate (round-2 review): a
    // bare has-a-doer-profile read is satisfied by a half-finished
    // enrollment, so both shapes are pinned — an account with a doer profile
    // whose enrollment never completed, and one with no doer profile at all.
    it('refuses a user whose doer enrollment is INCOMPLETE, even with a qualifying task', async () => {
      const HALF = 'doer-half-enrolled';
      await getAdminAuth().createUser({ uid: HALF, email: `${HALF}@ejm.org` });
      await getDb().collection('users').doc(HALF).set({
        uid: HALF, email: `${HALF}@ejm.org`, status: 'active',
        firstName: 'Half', lastName: 'Enrolled', dateOfBirth: dobYearsAgo(17),
        language: 'en',
        profiles: { doer: { enrollmentComplete: false, notifyNewTasks: false, categories: [] } },
        notifPrefs: {}, fcmTokens: [], createdAt: new Date(), updatedAt: new Date(),
      });
      // Give them a completed task, so ONLY the enrollment check can refuse.
      await seedTask('t-half', seed.family1Id, { assignedUserId: HALF });
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: HALF, referenceText: GOOD_TEXT, refName: 'M' }, parent1Token),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await getDb().collection('users').doc(HALF).delete();
      await getAdminAuth().deleteUser(HALF);
    });

    it('refuses a real user with NO doer profile at all', async () => {
      await seedTask('t-parent', seed.family1Id, { assignedUserId: seed.parent2.uid });
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: seed.parent2.uid, referenceText: GOOD_TEXT, refName: 'M' }, parent1Token),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    // The dedup key is (FAMILY, doer), not (parent, doer): a family speaks
    // once. Without this the co-parent could double the same family's voice
    // on an offer card.
    it('allows one endorsement per family — the CO-PARENT is refused as a duplicate', async () => {
      await callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token);
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Pierre' }, parent2Token),
      ).rejects.toMatchObject({ code: 'ALREADY_EXISTS', details: { reason: 'already_endorsed' } });
      expect((await getDb().collection('references').get()).size).toBe(1);
    });

    // The dedup is STATUS-BLIND, matching study's exactly
    // (submitTutorEndorsement.ts:59-64 runs the same three equalities with no
    // status filter). So a decline is permanent for that (family, doer) pair.
    // Pinned as a DECISION rather than left to be discovered: changing it
    // would be a platform behaviour change touching study too.
    it('is status-blind like study — a family cannot re-endorse after a DECLINE', async () => {
      const { referenceId } = await callFunction<{ referenceId: string }>(
        'doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token,
      );
      await callFunction('doRespondToEndorsement', { referenceId, action: 'decline' }, doerToken);
      expect((await getDb().collection('references').doc(referenceId).get()).data()!.status)
        .toBe('removed');
      await expect(
        callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token),
      ).rejects.toMatchObject({ code: 'ALREADY_EXISTS', details: { reason: 'already_endorsed' } });
    });
  });

  describe('doRespondToEndorsement', () => {
    let referenceId: string;

    beforeEach(async () => {
      await seedTask('t-done', seed.family1Id, { assignedUserId: DOER });
      const res = await callFunction<{ referenceId: string }>(
        'doSubmitEndorsement',
        { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' },
        parent1Token,
      );
      referenceId = res.referenceId;
    });

    it('accept publishes it — status approved, approvedAt set', async () => {
      const res = await callFunction<{ status: string }>(
        'doRespondToEndorsement', { referenceId, action: 'accept' }, doerToken,
      );
      expect(res.status).toBe('approved');
      const data = (await getDb().collection('references').doc(referenceId).get()).data()!;
      expect(data.status).toBe('approved');
      expect(data.approvedAt).toBeTruthy();
    });

    it('decline removes it — status removed, no approvedAt', async () => {
      await callFunction('doRespondToEndorsement', { referenceId, action: 'decline' }, doerToken);
      const data = (await getDb().collection('references').doc(referenceId).get()).data()!;
      expect(data.status).toBe('removed');
      expect(data.approvedAt).toBeUndefined();
    });

    it('refuses anyone but the named doer — including the submitting parent and another doer', async () => {
      for (const token of [parent1Token, otherDoerToken]) {
        await expect(
          callFunction('doRespondToEndorsement', { referenceId, action: 'accept' }, token),
        ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      }
      expect((await getDb().collection('references').doc(referenceId).get()).data()!.status).toBe('private');
    });

    it('refuses a SECOND response — the status guard, so a double-tap cannot double-publish', async () => {
      await callFunction('doRespondToEndorsement', { referenceId, action: 'accept' }, doerToken);
      await expect(
        callFunction('doRespondToEndorsement', { referenceId, action: 'decline' }, doerToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_pending' } });
      expect((await getDb().collection('references').doc(referenceId).get()).data()!.status).toBe('approved');
    });

    // sync-do says `decline`. study's `dismiss` must not be silently
    // accepted onto an undocumented path.
    it("rejects study's 'dismiss' vocabulary and any other action", async () => {
      for (const action of ['dismiss', 'remove', '', undefined]) {
        await expect(
          callFunction('doRespondToEndorsement', { referenceId, action }, doerToken),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      }
    });

    // A doer must not be able to respond to a sibling app's endorsement
    // through the do callable, even one that NAMES them — this is the
    // `appSource !== 'do'` half of the guard, which the `doerUserId !== uid`
    // half alone cannot reach.
    //
    // The fixture deliberately carries NO `babysitterUserId`. An earlier
    // version used a sit `family_submitted` doc keyed on the doer, which
    // trips sit's `notifyOnNewReference` trigger asynchronously; the
    // resulting `reference_received` landed in a LATER test's notification
    // assertions, and CI (slower than this machine) caught it as a flake this
    // suite had no business having.
    it('refuses a doc from a sibling app that names this doer', async () => {
      await getDb().collection('references').doc('study-ref').set({
        referenceId: 'study-ref', doerUserId: DOER, appSource: 'study',
        type: 'family_submitted', status: 'private',
        submittedByUserId: seed.parent1.uid, submittedByFamilyId: seed.family1Id,
        referenceText: 'Mislabelled endorsement.', createdAt: new Date(),
      });
      await expect(
        callFunction('doRespondToEndorsement', { referenceId: 'study-ref', action: 'accept' }, doerToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      // Untouched — a refusal must not have mutated it.
      expect((await getDb().collection('references').doc('study-ref').get()).data()!.status)
        .toBe('private');
    });

    it('refuses an unknown referenceId, and a slashed one before it reaches .doc()', async () => {
      await expect(
        callFunction('doRespondToEndorsement', { referenceId: 'nope', action: 'accept' }, doerToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        callFunction('doRespondToEndorsement', { referenceId: 'a/b/c/d', action: 'accept' }, doerToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    // Decision 12 keeps sync-do free of a rating AND of a count. The
    // denormalized counter study maintains for searchTutors has no reader
    // here, so nothing may mint one — a stray counter would then owe
    // deleteUser a decrement it does not have.
    it('mints NO profiles.doer.endorsementCount on accept', async () => {
      await callFunction('doRespondToEndorsement', { referenceId, action: 'accept' }, doerToken);
      const doer = (await getDb().collection('users').doc(DOER).get()).data()!;
      expect(doer.profiles.doer.endorsementCount).toBeUndefined();
    });
  });

  describe('the §10 notification trio', () => {
    async function typesFor(uid: string): Promise<string[]> {
      const snap = await getDb().collection('notifications').where('recipientUserId', '==', uid).get();
      return snap.docs.map((d) => d.data().type as string).sort();
    }

    it('submit notifies the DOER only', async () => {
      await seedTask('t-done', seed.family1Id, { assignedUserId: DOER });
      await callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token);
      expect(await typesFor(DOER)).toEqual(['doer_endorsement_received']);
      // The submitting family hears nothing yet — they just acted.
      expect(await typesFor(seed.parent1.uid)).toEqual([]);
    });

    it('accept notifies BOTH parents of the submitting family, and not the doer again', async () => {
      await seedTask('t-done', seed.family1Id, { assignedUserId: DOER });
      const { referenceId } = await callFunction<{ referenceId: string }>(
        'doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token,
      );
      await callFunction('doRespondToEndorsement', { referenceId, action: 'accept' }, doerToken);
      expect(await typesFor(seed.parent1.uid)).toEqual(['doer_endorsement_published']);
      expect(await typesFor(seed.parent2.uid)).toEqual(['doer_endorsement_published']);
      expect(await typesFor(DOER)).toEqual(['doer_endorsement_received']);
    });

    it('decline notifies the family with the DECLINED type', async () => {
      await seedTask('t-done', seed.family1Id, { assignedUserId: DOER });
      const { referenceId } = await callFunction<{ referenceId: string }>(
        'doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token,
      );
      await callFunction('doRespondToEndorsement', { referenceId, action: 'decline' }, doerToken);
      expect(await typesFor(seed.parent1.uid)).toEqual(['doer_endorsement_declined']);
    });
  });

  // §11.4 / issue #295: `references` is already in both GDPR paths, keyed by
  // REFERENCE_PROVIDER_KEYS — which lists `doerUserId` ahead of any doc
  // carrying it. These prove the field is genuinely handled now that it does.
  describe('GDPR coverage (§11.4)', () => {
    beforeEach(async () => {
      await seedTask('t-done', seed.family1Id, { assignedUserId: DOER });
      await callFunction('doSubmitEndorsement', { doerUserId: DOER, referenceText: GOOD_TEXT, refName: 'Marie' }, parent1Token);
    });

    it('exportUserData returns the endorsement for the DOER it names', async () => {
      const out = await callFunction<{ references: { doerUserId?: string }[] }>(
        'exportUserData', { targetUserId: DOER }, adminToken,
      );
      expect(out.references.some((r) => r.doerUserId === DOER)).toBe(true);
    });

    it('exportUserData returns it for the SUBMITTING parent too', async () => {
      const out = await callFunction<{ references: { doerUserId?: string }[] }>(
        'exportUserData', { targetUserId: seed.parent1.uid }, adminToken,
      );
      expect(out.references.some((r) => r.doerUserId === DOER)).toBe(true);
    });

    it("erasing the DOER deletes the endorsement — the doc is ABOUT them", async () => {
      await callFunction('deleteUser', { targetUserId: DOER }, adminToken);
      const left = await getDb().collection('references').where('doerUserId', '==', DOER).get();
      expect(left.empty).toBe(true);
      // Re-seed the doer for whatever runs next: deleteUser is destructive.
      await seedDoer(DOER);
      doerToken = await getIdToken(DOER);
    });

    it('erasing the SUBMITTING parent deletes it too — every field in it is their text', async () => {
      await callFunction('deleteUser', { targetUserId: seed.parent1.uid }, adminToken);
      const left = await getDb().collection('references').where('doerUserId', '==', DOER).get();
      expect(left.empty).toBe(true);
      // Destructive: this file's remaining work needs the family back.
      await clearAll();
      seed = await seedTestData();
      await seedDoer(DOER);
      await seedDoer(OTHER_DOER);
      parent1Token = await getIdToken(seed.parent1.uid);
      parent2Token = await getIdToken(seed.parent2.uid);
      parent3Token = await getIdToken(seed.parent3.uid);
      doerToken = await getIdToken(DOER);
      otherDoerToken = await getIdToken(OTHER_DOER);
      adminToken = await getIdToken(seed.admin.uid);
    });
  });
});
