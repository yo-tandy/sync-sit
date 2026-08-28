import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
  parisDateFromNow,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// PR6 contact reveal (decision 16; plan §6.4, §8, §14): doGetAssignedContact
// — the two-way boundary asserted from BOTH sides, the non-party-doer
// refusal, and the DO_CONTACT_GRACE_DAYS window in BOTH directions (served
// inside 7 days of a cancellation, refused after — via seeded cancelledAt,
// which is what the callable's clock compares against).

const DAY_MS = 24 * 60 * 60 * 1000;

function dobYearsAgo(years: number): Date {
  return new Date(Date.now() - years * 365.25 * DAY_MS - 40 * DAY_MS);
}

async function seedDoer(uid: string, contact: Record<string, unknown> = {}) {
  const db = getDb();
  await getAdminAuth().createUser({ uid, email: `${uid}@ejm.org` });
  await db.collection('users').doc(uid).set({
    uid,
    email: `${uid}@ejm.org`,
    status: 'active',
    firstName: `First-${uid}`,
    lastName: `Last-${uid}`,
    dateOfBirth: dobYearsAgo(17),
    ...contact,
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
}

async function postTask(parentToken: string): Promise<string> {
  const { taskId } = await callFunction<{ taskId: string }>('doPostTask', {
    category: 'green_thumb',
    subCategory: 'green_thumb_garden_watering',
    title: 'Water the plants',
    description: 'Terrace plants, twice a week.',
    photos: [],
    timing: 'ongoing',
    startDate: parisDateFromNow(1),
    cadence: { kind: 'weekly', days: ['wed'] },
    adultPresent: 'no',
    transportNeeded: false,
  }, parentToken);
  return taskId;
}

interface ContactResult {
  taskId: string;
  family: {
    familyName: string;
    address: string;
    parents: { firstName: string; lastName: string; email: string; phone?: string; whatsapp?: string }[];
  };
  doer: {
    firstName: string;
    lastName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    whatsapp: string | null;
  };
}

describe('doGetAssignedContact (decision 16)', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent3Token: string; // unrelated family
  let doerToken: string; // the assigned student
  let rivalToken: string; // non-party doer WITH an offer on the same task
  let taskId: string;
  let acceptedOfferId: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016', city: 'Paris',
    });
    await seedDoer('doer-con-1', {
      contactEmail: 'dora@personal.test',
      contactPhone: '+33 611111111',
    });
    await seedDoer('doer-con-rival');
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    doerToken = await getIdToken('doer-con-1');
    rivalToken = await getIdToken('doer-con-rival');

    // The full pipeline: post → two offers → accept one.
    taskId = await postTask(parent1Token);
    const winner = await callFunction<{ offerId: string }>(
      'doSubmitOffer',
      { taskId, price: 25, priceBasis: 'flat', message: 'I can do it.' },
      doerToken,
    );
    acceptedOfferId = winner.offerId;
    await callFunction<{ offerId: string }>(
      'doSubmitOffer',
      { taskId, price: 20, priceBasis: 'flat', message: 'Me too.' },
      rivalToken,
    );
    await callFunction('doAcceptOffer', { offerId: acceptedOfferId }, parent1Token);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('BEFORE assignment there is nothing to reveal (open task refuses)', async () => {
    const openTaskId = await postTask(parent1Token);
    await expect(callFunction('doGetAssignedContact', { taskId: openTaskId }, parent1Token))
      .rejects.toMatchObject({ code: 'FAILED_PRECONDITION', details: { reason: 'not_assigned' } });
  });

  it('the assigned DOER gets both halves — family address + parent channels, live', async () => {
    const result = await callFunction<ContactResult>(
      'doGetAssignedContact', { taskId }, doerToken,
    );
    expect(result.family.familyName).toBe('Dupont');
    expect(result.family.address).toBe('15 Rue de Passy, 75016 Paris');
    // Parent channels come from the parents' user docs (profiles.parent) —
    // the family doc itself carries no phone.
    const marie = result.family.parents.find((p) => p.firstName === 'Marie')!;
    expect(marie.phone).toBe('+33 612345678');
    // The doer's own half comes back too (the call is two-way by design).
    expect(result.doer.contactEmail).toBe('dora@personal.test');
  });

  it('a FAMILY member gets both halves — the doer channels via getContact', async () => {
    const result = await callFunction<ContactResult>(
      'doGetAssignedContact', { taskId }, parent1Token,
    );
    expect(result.doer.firstName).toBe('First-doer-con-1');
    expect(result.doer.contactEmail).toBe('dora@personal.test');
    expect(result.doer.contactPhone).toBe('+33 611111111');
    expect(result.family.address).toBe('15 Rue de Passy, 75016 Paris');
  });

  it('LIVE, not snapshotted: a post-acceptance contact edit is reflected on the next call', async () => {
    await getDb().collection('users').doc('doer-con-1').update({
      contactPhone: '+33 622222222',
    });
    const result = await callFunction<ContactResult>(
      'doGetAssignedContact', { taskId }, parent1Token,
    );
    expect(result.doer.contactPhone).toBe('+33 622222222');
  });

  it('a NON-PARTY doer with a (flipped) offer on the SAME task is refused', async () => {
    // The rival's offer went declined/sibling_accepted at acceptance —
    // standing is the ACCEPTED offer, and they are not on it.
    await expect(callFunction('doGetAssignedContact', { taskId }, rivalToken))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('an unrelated family and an unauthenticated caller are refused', async () => {
    await expect(callFunction('doGetAssignedContact', { taskId }, parent3Token))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(callFunction('doGetAssignedContact', { taskId }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('a COMPLETED task keeps serving both sides', async () => {
    await callFunction('doMarkTaskDone', { taskId }, parent1Token); // family's mark completes
    const result = await callFunction<ContactResult>(
      'doGetAssignedContact', { taskId }, doerToken,
    );
    expect(result.family.address).toBe('15 Rue de Passy, 75016 Paris');
  });

  describe('the §6.4 aftermath grace on cancellation — both directions', () => {
    let cancelledTaskId: string;

    beforeAll(async () => {
      // A second full pipeline, then cancel from the DOER side (§6.5:
      // either side may cancel an assigned task).
      cancelledTaskId = await postTask(parent1Token);
      const { offerId } = await callFunction<{ offerId: string }>(
        'doSubmitOffer',
        { taskId: cancelledTaskId, price: 25, priceBasis: 'flat', message: 'On it.' },
        doerToken,
      );
      await callFunction('doAcceptOffer', { offerId }, parent1Token);
      await callFunction('doCancelTask', { taskId: cancelledTaskId }, doerToken);
    });

    it('INSIDE the 7-day grace: the pair is STILL served — cancellation does not cut the line dead', async () => {
      for (const token of [doerToken, parent1Token]) {
        const result = await callFunction<ContactResult>(
          'doGetAssignedContact', { taskId: cancelledTaskId }, token,
        );
        expect(result.family.address).toBe('15 Rue de Passy, 75016 Paris');
      }
      // A non-party stays refused during the grace, of course.
      await expect(callFunction('doGetAssignedContact', { taskId: cancelledTaskId }, parent3Token))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('AFTER the grace elapses: refused — the line does not stay immortal either', async () => {
      // Seed the clock the callable compares against: cancelledAt 8 days
      // back (DO_CONTACT_GRACE_DAYS = 7).
      await getDb().collection('doTasks').doc(cancelledTaskId).update({
        cancelledAt: new Date(Date.now() - 8 * DAY_MS),
      });
      for (const token of [doerToken, parent1Token]) {
        await expect(callFunction('doGetAssignedContact', { taskId: cancelledTaskId }, token))
          .rejects.toMatchObject({
            code: 'FAILED_PRECONDITION',
            details: { reason: 'grace_elapsed' },
          });
      }
    });
  });
});
