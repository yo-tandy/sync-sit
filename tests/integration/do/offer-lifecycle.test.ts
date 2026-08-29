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

// PR6 offer lifecycle (plan §4.2, §6.2, §8, §11.1, §14): submit / update /
// withdraw / decline, the ceilings with slot return, the resurrection
// matrix branch by branch, and the §11.1 floor re-check. Acceptance (§6.4)
// lives in offer-accept.test.ts, the guardian decision in
// offer-guardian.test.ts, the contact reveal in offer-contact.test.ts.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRESTORE_PORT = process.env.TEST_FIRESTORE_PORT ?? '8080';

/** DOB that makes the account `years` old (with a 40-day margin so month
 *  arithmetic can never flip the age around the test date). */
function dobYearsAgo(years: number): Date {
  return new Date(Date.now() - years * 365.25 * DAY_MS - 40 * DAY_MS);
}

/**
 * Rules-eye document read (§14's "assert via rules-eye read as the family"):
 * the Firestore emulator enforces firestore.rules for non-admin bearer
 * tokens, so a REST GET with a real Auth-emulator idToken answers exactly
 * what a client SDK would be allowed to see. 200 → readable, 403 → denied.
 */
async function clientReadStatus(path: string, idToken: string): Promise<number> {
  const res = await fetch(
    `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  return res.status;
}

/** A doer user doc in the §3.3 shape; governed adds the mirror + link. */
async function seedDoer(
  uid: string,
  opts: {
    age: number;
    governedFamilyId?: string;
    linkStatus?: 'active' | 'revoked';
    status?: string;
    bio?: string | null;
  },
) {
  const db = getDb();
  await getAdminAuth().createUser({ uid, email: `${uid}@ejm.org` });
  await db.collection('users').doc(uid).set({
    uid,
    email: `${uid}@ejm.org`,
    status: opts.status ?? 'active',
    firstName: `First-${uid}`,
    lastName: `Last-${uid}`,
    dateOfBirth: dobYearsAgo(opts.age),
    ...(opts.governedFamilyId && opts.linkStatus !== 'revoked'
      ? { governedBy: { familyId: opts.governedFamilyId, linkedAt: new Date() } }
      : {}),
    profiles: {
      doer: {
        enrollmentComplete: true,
        notifyNewTasks: true,
        categories: ['green_thumb', 'ikea'],
        bio: opts.bio ?? null,
        defaultRate: null,
        hasCar: false,
        hasBike: true,
      },
    },
    notifPrefs: {},
    fcmTokens: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (opts.governedFamilyId) {
    // The revoked-link shape mirrors the enroll-doer fixtures (§11.1's
    // durability pin): link doc kept with status 'revoked', governedBy
    // mirror GONE from the user doc.
    await db.collection('guardianLinks').doc(uid).set({
      childUid: uid,
      familyId: opts.governedFamilyId,
      createdByParentUid: 'seed-parent',
      status: opts.linkStatus ?? 'active',
      origin: 'parent_created',
      requestedAt: new Date(),
      ...(opts.linkStatus === 'revoked'
        ? { revokedAt: new Date() }
        : { confirmedAt: new Date() }),
    });
  }
}

/** An OPEN board task, seeded directly (posting is PR5's suite). */
async function seedOpenTask(
  taskId: string,
  familyId: string,
  opts: { subCategory?: string; offerCount?: number; status?: string; expiresInDays?: number } = {},
) {
  const now = new Date();
  const subCategory = opts.subCategory ?? 'green_thumb_garden_watering';
  await getDb().collection('doTasks').doc(taskId).set({
    taskId,
    familyId,
    createdByUserId: 'seed-parent',
    familyName: 'Dupont',
    areaLabel: '16e',
    category: 'green_thumb',
    subCategory,
    title: `Task ${taskId}`,
    description: 'Seeded for the offer suite.',
    photos: [],
    timing: 'ongoing',
    date: null, startTime: null, endTime: null, dueDate: null,
    startDate: parisDateFromNow(1), endDate: null,
    cadence: { kind: 'weekly', days: ['sat'] },
    estimatedHours: null, suggestedBudget: null,
    adultPresent: 'no', toolsProvided: null, transportNeeded: false,
    status: opts.status ?? 'open',
    offerCount: opts.offerCount ?? 0,
    assignedUserId: null, assignedOfferId: null, assignedAt: null,
    agreedPrice: null, doerMarkedDoneAt: null, completedAt: null,
    cancelledAt: null, cancelledBy: null,
    createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + (opts.expiresInDays ?? 10) * DAY_MS),
  });
}

function offerPayload(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    taskId,
    price: 25,
    priceBasis: 'flat',
    message: 'I water plants every summer.',
    ...overrides,
  };
}

describe('offer lifecycle callables (submit / update / withdraw / decline)', () => {
  let seed: SeedData;
  let parent1Token: string; // hiring family (Dupont, verified)
  let parent3Token: string; // unrelated family (Martin)
  let doerToken: string; // ungoverned 17yo
  let doer2Token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016', city: 'Paris',
    });
    await seedDoer('doer-life-1', { age: 17, bio: 'Green thumbs.' });
    await seedDoer('doer-life-2', { age: 16 });
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    doerToken = await getIdToken('doer-life-1');
    doer2Token = await getIdToken('doer-life-2');
  });

  afterAll(async () => {
    await clearAll();
  });

  describe('doSubmitOffer', () => {
    it('rejects unauthenticated and non-doer callers', async () => {
      await seedOpenTask('t-sub-1', seed.family1Id);
      await expect(callFunction('doSubmitOffer', offerPayload('t-sub-1')))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      await expect(callFunction('doSubmitOffer', offerPayload('t-sub-1'), parent1Token))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects invalid input before any doc is touched', async () => {
      for (const bad of [
        { price: -1 },
        { price: 1001 },
        { priceBasis: 'per_visit' },
        { message: '' },
        { message: 'x'.repeat(1001) },
        { helper: { firstName: 'Ana' } }, // missing lastName + age
        { helper: { firstName: 'Ana', lastName: 'B', age: 0 } },
        { availabilityNote: 'x'.repeat(501) },
      ]) {
        await expect(callFunction('doSubmitOffer', offerPayload('t-sub-1', bad), doerToken))
          .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      }
    });

    it('creates the offer at the DETERMINISTIC id with both §4.2 denormalized blocks, guardian ABSENT, offerCount 1', async () => {
      const result = await callFunction<{ offerId: string; status: string }>(
        'doSubmitOffer',
        offerPayload('t-sub-1', {
          helper: { firstName: 'Ana', lastName: 'Helper', age: 16 },
          availabilityNote: 'Saturdays',
        }),
        doerToken,
      );
      expect(result.offerId).toBe('t-sub-1_doer-life-1');
      expect(result.status).toBe('pending');

      const offer = (await getDb().collection('taskOffers').doc(result.offerId).get()).data()!;
      expect(offer.taskId).toBe('t-sub-1');
      expect(offer.doerUserId).toBe('doer-life-1');
      expect(offer.familyId).toBe(seed.family1Id);
      // Block 1: the family's offer card renders from the offer alone.
      expect(offer.doerFirstName).toBe('First-doer-life-1');
      expect(offer.doerBio).toBe('Green thumbs.');
      expect(offer.doerPhotoUrl).toBeNull();
      // Block 2: the student's "My offers" line for terminal offers.
      expect(offer.taskTitle).toBe('Task t-sub-1');
      expect(offer.taskCategory).toBe('green_thumb');
      expect(offer.taskTiming).toBe('ongoing');
      expect(offer.helper).toEqual({ firstName: 'Ana', lastName: 'Helper', age: 16 });
      expect(offer.declinedReason).toBeNull();
      // §4.2's absent-not-null contract: the guardian key must NOT exist.
      expect('guardian' in offer).toBe(false);

      const task = (await getDb().collection('doTasks').doc('t-sub-1').get()).data()!;
      expect(task.offerCount).toBe(1);
    });

    it('a second submit while pending → ALREADY_EXISTS (one offer per pair is structural)', async () => {
      await expect(callFunction('doSubmitOffer', offerPayload('t-sub-1'), doerToken))
        .rejects.toMatchObject({ code: 'ALREADY_EXISTS', details: { reason: 'offer_exists' } });
    });

    it('the §11.3 helper is FAMILY-visible pre-accept (rules-eye read as the hiring family)', async () => {
      const res = await fetch(
        `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/taskOffers/t-sub-1_doer-life-1`,
        { headers: { Authorization: `Bearer ${parent1Token}` } },
      );
      expect(res.status).toBe(200);
      // `res.json()` is `unknown`; name the slice of the Firestore REST
      // document shape these two assertions walk.
      const body = (await res.json()) as {
        fields: {
          helper: {
            mapValue: {
              fields: {
                firstName: { stringValue: string };
                age: { integerValue: string };
              };
            };
          };
        };
      };
      expect(body.fields.helper.mapValue.fields.firstName.stringValue).toBe('Ana');
      expect(body.fields.helper.mapValue.fields.age.integerValue).toBe('16');
    });

    it('refuses a task that is not open / is expired (task_not_open)', async () => {
      await seedOpenTask('t-sub-assigned', seed.family1Id, { status: 'assigned' });
      await expect(callFunction('doSubmitOffer', offerPayload('t-sub-assigned'), doerToken))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'task_not_open' } });
      await seedOpenTask('t-sub-expired', seed.family1Id, { expiresInDays: -1 });
      await expect(callFunction('doSubmitOffer', offerPayload('t-sub-expired'), doerToken))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'task_not_open' } });
      await expect(callFunction('doSubmitOffer', offerPayload('t-sub-missing'), doerToken))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('§11.1 durability: a REVOKED-supervision under-15 doer is refused under_15 at submit', async () => {
      // The PR6 half deferred from PR4: profiles.doer survives revocation
      // (enrollment gates never re-run), so the floor must re-fire at the
      // offer chokepoint. Link shape mirrors the enroll-doer fixtures:
      // link 'revoked', governedBy mirror gone, profile intact, account
      // active.
      await seedDoer('doer-revoked-13', {
        age: 13, governedFamilyId: 'family-martin', linkStatus: 'revoked',
      });
      const token = await getIdToken('doer-revoked-13');
      await expect(callFunction('doSubmitOffer', offerPayload('t-sub-1'), token))
        .rejects.toMatchObject({
          code: 'FAILED_PRECONDITION',
          details: { reason: 'under_15' },
        });
    });

    it('a GOVERNED under-15 doer passes the floor (supervision is their protection) — unflagged sub-category → pending', async () => {
      await seedDoer('doer-governed-13', { age: 13, governedFamilyId: 'family-martin' });
      const token = await getIdToken('doer-governed-13');
      const { status } = await callFunction<{ status: string }>(
        'doSubmitOffer', offerPayload('t-sub-1'), token,
      );
      // garden_watering is not guardianConsent-flagged: no gate, family
      // sees it immediately.
      expect(status).toBe('pending');
    });

    it('flagged sub-category + governed caller → pending_guardian with the guardian map; INVISIBLE to the hiring family', async () => {
      await seedOpenTask('t-sub-flagged', seed.family1Id, { subCategory: 'green_thumb_lawn_mowing' });
      const token = await getIdToken('doer-governed-13');
      const { status, offerId } = await callFunction<{ status: string; offerId: string }>(
        'doSubmitOffer', offerPayload('t-sub-flagged'), token,
      );
      expect(status).toBe('pending_guardian');
      const offer = (await getDb().collection('taskOffers').doc(offerId).get()).data()!;
      expect(offer.guardian).toEqual({
        required: true,
        familyId: 'family-martin', // the SUPERVISING family, not the hiring one
        decidedAt: null,
        decidedByUid: null,
      });
      // §6.2's invisibility promise, pre-decision half: the hiring family's
      // rules-eye read is DENIED while the offer awaits the parent.
      expect(await clientReadStatus(`taskOffers/${offerId}`, parent1Token)).toBe(403);
      // The student still counts toward the live offerCount.
      const task = (await getDb().collection('doTasks').doc('t-sub-flagged').get()).data()!;
      expect(task.offerCount).toBe(1);
    });

    it('flagged sub-category + UNGOVERNED (15+) caller → pending (no guardian to ask)', async () => {
      const { status, offerId } = await callFunction<{ status: string; offerId: string }>(
        'doSubmitOffer', offerPayload('t-sub-flagged'), doerToken,
      );
      expect(status).toBe('pending');
      const offer = (await getDb().collection('taskOffers').doc(offerId).get()).data()!;
      expect('guardian' in offer).toBe(false);
    });
  });

  describe('doUpdateOffer', () => {
    it('the offering student edits price/message/helper while pending', async () => {
      await callFunction('doUpdateOffer', {
        offerId: 't-sub-1_doer-life-1',
        price: 30,
        priceBasis: 'hourly',
        message: 'Updated terms.',
        helper: null,
        availabilityNote: null,
      }, doerToken);
      const offer = (await getDb().collection('taskOffers').doc('t-sub-1_doer-life-1').get()).data()!;
      expect(offer.price).toBe(30);
      expect(offer.priceBasis).toBe('hourly');
      expect(offer.message).toBe('Updated terms.');
      expect(offer.helper).toBeNull();
      expect(offer.status).toBe('pending');
    });

    it('refuses another student, the family, and a pending_guardian offer', async () => {
      const payload = {
        offerId: 't-sub-1_doer-life-1', price: 10, priceBasis: 'flat',
        message: 'Hijack attempt', helper: null, availabilityNote: null,
      };
      await expect(callFunction('doUpdateOffer', payload, doer2Token))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(callFunction('doUpdateOffer', payload, parent1Token))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      // pending_guardian is not editable: edits under an approving parent
      // would be the laundering hole in miniature.
      const gToken = await getIdToken('doer-governed-13');
      await expect(callFunction('doUpdateOffer', {
        ...payload, offerId: 't-sub-flagged_doer-governed-13',
      }, gToken)).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION', details: { reason: 'not_pending' },
      });
    });
  });

  describe('doWithdrawOffer + doDeclineOffer, and §4.1 slot return', () => {
    it('withdraw → withdrawn, offerCount decrements, and the doc is INVISIBLE to the family (rules-eye)', async () => {
      await seedOpenTask('t-wd-1', seed.family1Id);
      await callFunction('doSubmitOffer', offerPayload('t-wd-1'), doerToken);
      let task = (await getDb().collection('doTasks').doc('t-wd-1').get()).data()!;
      expect(task.offerCount).toBe(1);

      await callFunction('doWithdrawOffer', { offerId: 't-wd-1_doer-life-1' }, doerToken);
      const offer = (await getDb().collection('taskOffers').doc('t-wd-1_doer-life-1').get()).data()!;
      expect(offer.status).toBe('withdrawn');
      task = (await getDb().collection('doTasks').doc('t-wd-1').get()).data()!;
      expect(task.offerCount).toBe(0);
      // withdrawn is outside the family's §7.2 allow-list.
      expect(await clientReadStatus('taskOffers/t-wd-1_doer-life-1', parent1Token)).toBe(403);

      // Re-withdrawing a non-live offer refuses.
      await expect(callFunction('doWithdrawOffer', { offerId: 't-wd-1_doer-life-1' }, doerToken))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_live' } });
      // Another student cannot withdraw it either.
      await expect(callFunction('doWithdrawOffer', { offerId: 't-wd-1_doer-life-1' }, doer2Token))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('family declines a pending offer → declined / family_declined, slot returned', async () => {
      await callFunction('doSubmitOffer', offerPayload('t-wd-1'), doer2Token);
      // Unrelated family cannot decline.
      await expect(callFunction('doDeclineOffer', { offerId: 't-wd-1_doer-life-2' }, parent3Token))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      // The student cannot decline their own offer through the family path.
      await expect(callFunction('doDeclineOffer', { offerId: 't-wd-1_doer-life-2' }, doer2Token))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

      await callFunction('doDeclineOffer', { offerId: 't-wd-1_doer-life-2' }, parent1Token);
      const offer = (await getDb().collection('taskOffers').doc('t-wd-1_doer-life-2').get()).data()!;
      expect(offer.status).toBe('declined');
      expect(offer.declinedReason).toBe('family_declined');
      const task = (await getDb().collection('doTasks').doc('t-wd-1').get()).data()!;
      expect(task.offerCount).toBe(0);

      // Declining again refuses (not pending any more).
      await expect(callFunction('doDeclineOffer', { offerId: 't-wd-1_doer-life-2' }, parent1Token))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_pending' } });
    });

    it('a pending_guardian offer cannot be declined by the hiring family (they cannot see it)', async () => {
      await expect(callFunction('doDeclineOffer', { offerId: 't-sub-flagged_doer-governed-13' }, parent1Token))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_pending' } });
    });
  });

  describe('ceilings (§6.3) and slot return', () => {
    it('DO_OFFER_MAX_PER_TASK: 25 live offers refuse the 26th with task_offer_cap; withdrawal AND family decline both return the slot', async () => {
      await seedOpenTask('t-cap-1', seed.family1Id);
      await callFunction('doSubmitOffer', offerPayload('t-cap-1'), doerToken);
      // Simulate 24 more live offers via the transactionally-maintained
      // count the callable enforces against (§6.4's write-set bound).
      await getDb().collection('doTasks').doc('t-cap-1').update({ offerCount: 25 });
      await expect(callFunction('doSubmitOffer', offerPayload('t-cap-1'), doer2Token))
        .rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED', details: { reason: 'task_offer_cap' } });

      // Withdrawal returns the slot: the task does NOT seal shut (§4.1's
      // live-not-lifetime rationale).
      await callFunction('doWithdrawOffer', { offerId: 't-cap-1_doer-life-1' }, doerToken);
      const { status } = await callFunction<{ status: string }>(
        'doSubmitOffer', offerPayload('t-cap-1'), doer2Token,
      );
      expect(status).toBe('pending');

      // family_declined returns the slot too (decision 18's half of the
      // slot-return pin): count back at 25 → decline → a resurrection fits.
      await getDb().collection('doTasks').doc('t-cap-1').update({ offerCount: 25 });
      await expect(callFunction('doSubmitOffer', offerPayload('t-cap-1'), doerToken))
        .rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED', details: { reason: 'task_offer_cap' } });
      await callFunction('doDeclineOffer', { offerId: 't-cap-1_doer-life-2' }, parent1Token);
      const again = await callFunction<{ status: string }>(
        'doSubmitOffer', offerPayload('t-cap-1'), doerToken,
      );
      expect(again.status).toBe('pending');
    });

    it('DO_OFFER_MAX_ACTIVE: a student\'s 11th live offer refuses with offer_cap; withdrawing one returns the slot', async () => {
      await seedDoer('doer-eager', { age: 17 });
      const eagerToken = await getIdToken('doer-eager');
      for (let i = 0; i < 10; i++) {
        await seedOpenTask(`t-active-${i}`, seed.family1Id);
        await callFunction('doSubmitOffer', offerPayload(`t-active-${i}`), eagerToken);
      }
      await seedOpenTask('t-active-10', seed.family1Id);
      await expect(callFunction('doSubmitOffer', offerPayload('t-active-10'), eagerToken))
        .rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED', details: { reason: 'offer_cap' } });

      await callFunction('doWithdrawOffer', { offerId: 't-active-0_doer-eager' }, eagerToken);
      const { status } = await callFunction<{ status: string }>(
        'doSubmitOffer', offerPayload('t-active-10'), eagerToken,
      );
      expect(status).toBe('pending');
    });
  });

  describe('the §4.2 resurrection matrix, branch by branch', () => {
    it('withdrawn → resurrect: full path re-run, price/message/helper RESET', async () => {
      await seedOpenTask('t-res-1', seed.family1Id);
      await callFunction('doSubmitOffer', offerPayload('t-res-1', {
        price: 20, message: 'First life.', helper: { firstName: 'Old', lastName: 'Helper', age: 17 },
      }), doerToken);
      await callFunction('doWithdrawOffer', { offerId: 't-res-1_doer-life-1' }, doerToken);

      const { status } = await callFunction<{ status: string }>(
        'doSubmitOffer', offerPayload('t-res-1', { price: 35, message: 'Second life.' }), doerToken,
      );
      expect(status).toBe('pending');
      const offer = (await getDb().collection('taskOffers').doc('t-res-1_doer-life-1').get()).data()!;
      expect(offer.price).toBe(35);
      expect(offer.message).toBe('Second life.');
      expect(offer.helper).toBeNull(); // reset from the NEW submission
      expect(offer.declinedReason).toBeNull();
      const task = (await getDb().collection('doTasks').doc('t-res-1').get()).data()!;
      expect(task.offerCount).toBe(1); // re-incremented, not double-counted
    });

    it('expired → resurrect', async () => {
      await seedOpenTask('t-res-2', seed.family1Id);
      await callFunction('doSubmitOffer', offerPayload('t-res-2'), doerToken);
      await getDb().collection('taskOffers').doc('t-res-2_doer-life-1').update({ status: 'expired' });
      await getDb().collection('doTasks').doc('t-res-2').update({ offerCount: 0 });
      const { status } = await callFunction<{ status: string }>(
        'doSubmitOffer', offerPayload('t-res-2'), doerToken,
      );
      expect(status).toBe('pending');
    });

    it('family_declined → resurrect (decision 18), and the guardian gate RE-RUNS (the laundering pin)', async () => {
      // Flagged sub-category, governed student: first life went through
      // pending_guardian (approved by the parent in the guardian suite's
      // flow — here we place the offer in the family-declined end state
      // directly, which is what the family's decline of an approved offer
      // leaves behind).
      await seedOpenTask('t-res-3', seed.family1Id, { subCategory: 'green_thumb_lawn_mowing' });
      const gToken = await getIdToken('doer-governed-13');
      await callFunction('doSubmitOffer', offerPayload('t-res-3'), gToken);
      await getDb().collection('taskOffers').doc('t-res-3_doer-governed-13').update({
        status: 'declined',
        declinedReason: 'family_declined',
        'guardian.decidedAt': new Date(),
        'guardian.decidedByUid': seed.parent3.uid,
      });
      await getDb().collection('doTasks').doc('t-res-3').update({ offerCount: 0 });

      const { status } = await callFunction<{ status: string }>(
        'doSubmitOffer', offerPayload('t-res-3', { price: 40 }), gToken,
      );
      // NOT pending: the resurrection re-ran the §6.2 gate — a student
      // cannot launder a flagged offer past their parent via the
      // decline-resubmit cycle any more than via withdraw-resubmit.
      expect(status).toBe('pending_guardian');
      const offer = (await getDb().collection('taskOffers').doc('t-res-3_doer-governed-13').get()).data()!;
      expect(offer.guardian.decidedAt).toBeNull(); // a FRESH gate, undecided
      expect(offer.guardian.decidedByUid).toBeNull();
      expect(offer.price).toBe(40);
    });

    it('declined / sibling_accepted and task_closed → refused even against an open task (defensive branch)', async () => {
      await seedOpenTask('t-res-4', seed.family1Id);
      for (const declinedReason of ['sibling_accepted', 'task_closed'] as const) {
        await getDb().collection('taskOffers').doc('t-res-4_doer-life-1').set({
          offerId: 't-res-4_doer-life-1', taskId: 't-res-4', doerUserId: 'doer-life-1',
          familyId: seed.family1Id, doerFirstName: 'F', doerPhotoUrl: null, doerBio: null,
          taskTitle: 'T', taskCategory: 'green_thumb', taskTiming: 'ongoing',
          price: 10, priceBasis: 'flat', message: 'm', helper: null, availabilityNote: null,
          status: 'declined', declinedReason,
          createdAt: new Date(), updatedAt: new Date(),
        });
        await expect(callFunction('doSubmitOffer', offerPayload('t-res-4'), doerToken))
          .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'task_not_open' } });
      }
    });

    it('accepted → refused as already-exists', async () => {
      await seedOpenTask('t-res-5', seed.family1Id);
      await getDb().collection('taskOffers').doc('t-res-5_doer-life-1').set({
        offerId: 't-res-5_doer-life-1', taskId: 't-res-5', doerUserId: 'doer-life-1',
        familyId: seed.family1Id, doerFirstName: 'F', doerPhotoUrl: null, doerBio: null,
        taskTitle: 'T', taskCategory: 'green_thumb', taskTiming: 'ongoing',
        price: 10, priceBasis: 'flat', message: 'm', helper: null, availabilityNote: null,
        status: 'accepted', declinedReason: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await expect(callFunction('doSubmitOffer', offerPayload('t-res-5'), doerToken))
        .rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    });
  });
});
