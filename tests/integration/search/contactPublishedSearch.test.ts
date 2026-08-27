import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function dateFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().split('T')[0];
}

/**
 * contactPublishedSearch (issue #207 PR3, sit contact inversion). Pins:
 * - the EXACT minted appointment shape, including the WITHHELD address/latLng/
 *   pets/familyNote/familyPhotoUrl — disclosure waits for the family's accept;
 * - the age backstop shared with searchBabysitters still runs here (a
 *   published search must not be a route around the only operative age gate);
 * - a HIDDEN (searchable: false) sitter is deliberately ACCEPTED — the widened
 *   audience is the feature;
 * - expired / withdrawn / duplicate / blocked / non-babysitter all rejected.
 */
describe('contactPublishedSearch (sit)', () => {
  let seed: SeedData;
  let parentToken: string;
  let sitterToken: string;   // babysitter1, active + searchable
  let hiddenToken: string;   // babysitter4, active but searchable: false

  // Age-backstop fixtures, computed against the real clock exactly as the
  // searchBabysitters age-gate suite does (tests/integration/search/
  // search-babysitters.test.ts:118-140).
  function schoolYearEnd(): number {
    const d = new Date();
    return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
  }
  function gradYearForExpectedAge(expectedAge: number): number {
    return (schoolYearEnd() + (18 - expectedAge)) % 100;
  }
  function dobWithAge(age: number): Date {
    const d = new Date();
    let y = d.getFullYear();
    let m = d.getMonth() - 5;
    if (m < 0) { m += 12; y -= 1; }
    return new Date(`${y - age}-${String(m + 1).padStart(2, '0')}-15T00:00:00Z`);
  }

  const GRAD_15 = gradYearForExpectedAge(15);
  const UNDER_15_UID = 'contact-gate-under15';
  const MISMATCH_UID = 'contact-gate-mismatch';
  const NO_DOB_UID = 'contact-gate-nodob';

  async function seedSitter(uid: string, ejemEmail: string, dateOfBirth: Date | null) {
    await getDb().collection('users').doc(uid).set({
      uid,
      email: ejemEmail,
      status: 'active',
      firstName: `First-${uid}`,
      lastName: `Last-${uid}`,
      ...(dateOfBirth ? { dateOfBirth } : {}),
      profiles: {
        babysitter: {
          enrollmentComplete: true,
          ejemEmail,
          searchable: true,
          hourlyRate: 10,
          contactEmail: ejemEmail,
        },
      },
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /** Publish a real search through the callable so the shape can never drift. */
  async function publish(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await callFunction<{ publishedSearchId: string }>(
      'publishSearch',
      {
        type: 'one_time',
        date: dateFromNow(2),
        startTime: '18:00',
        endTime: '22:00',
        kidIds: ['kid1', 'kid2'],
        offeredRate: 15,
        additionalInfo: 'Two easy kids',
        ...overrides,
      },
      parentToken,
    );
    return res.publishedSearchId;
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
    sitterToken = await getIdToken(seed.babysitter1.uid);
    hiddenToken = await getIdToken(seed.babysitter4.uid);

    // publishSearch resolves the area label from the family doc's postcode.
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016',
      city: 'Paris',
      pets: 'One cat',
      note: 'Bedtime is 20:30',
    });

    await seedSitter(UNDER_15_UID, `contact.under${GRAD_15}@ejm.org`, dobWithAge(14));
    await seedSitter(MISMATCH_UID, `contact.mismatch${GRAD_15}@ejm.org`, dobWithAge(21));
    await seedSitter(NO_DOB_UID, `contact.nodob${GRAD_15}@ejm.org`, null);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    for (const col of ['publishedSearches', 'appointments']) {
      const docs = await db.collection(col).get();
      await Promise.all(docs.docs.map((d) => d.ref.delete()));
    }
  });

  it('rejects unauthenticated calls', async () => {
    const id = await publish();
    await expect(callFunction('contactPublishedSearch', { publishedSearchId: id })).rejects.toThrow();
  });

  it('rejects a caller with no babysitter profile', async () => {
    const id = await publish();
    await expect(
      callFunction('contactPublishedSearch', { publishedSearchId: id }, parentToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a sitter who stopped mid-enrollment (no DOB yet = age-gate bypass)', async () => {
    // Callables are reachable regardless of rules, and the board's READ rule
    // requires enrollmentComplete. An incomplete account has no DOB (the
    // wizard collects it), so it would land in the age backstop's legacy
    // missing-DOB tolerance and pass unconditionally (PR #212 review).
    const id = await publish();
    const db = getDb();
    const uid = seed.babysitter2.uid;
    const before = (await db.collection('users').doc(uid).get()).data()!;
    await db.collection('users').doc(uid).update({
      'profiles.babysitter.enrollmentComplete': false,
      dateOfBirth: FieldValue.delete(),
    });
    const token = await getIdToken(uid);
    try {
      await expect(
        callFunction('contactPublishedSearch', { publishedSearchId: id }, token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    } finally {
      await db.collection('users').doc(uid).set(before);
    }
  });

  it('rejects a blocked babysitter (status is the hard ban gate)', async () => {
    const id = await publish();
    const db = getDb();
    await db.collection('users').doc(seed.babysitter2.uid).update({ status: 'blocked' });
    const blockedToken = await getIdToken(seed.babysitter2.uid);
    try {
      await expect(
        callFunction('contactPublishedSearch', { publishedSearchId: id }, blockedToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    } finally {
      await db.collection('users').doc(seed.babysitter2.uid).update({ status: 'active' });
    }
  });

  it('mints the appointment in the sendContactRequest shape, with the address WITHHELD', async () => {
    const id = await publish();
    const res = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id, message: 'I am free that evening' },
      sitterToken,
    );
    expect(res.appointmentId).toBeTruthy();

    const apt = (await getDb().collection('appointments').doc(res.appointmentId).get()).data()!;

    // The inversion markers.
    expect(apt.initiatedBy).toBe('babysitter');
    expect(apt.publishedSearchId).toBe(id);
    expect(apt.createdByUserId).toBe(seed.babysitter1.uid);
    expect(apt.babysitterUserId).toBe(seed.babysitter1.uid);
    expect(apt.searchId).toBeNull();

    // The standard shape the family dashboard and respondToRequest expect.
    expect(apt.appointmentId).toBe(res.appointmentId);
    expect(apt.status).toBe('pending');
    expect(apt.familyId).toBe(seed.family1Id);
    expect(apt.familyName).toBe('Dupont');
    expect(apt.type).toBe('one_time');
    expect(apt.startTime).toBe('18:00');
    expect(apt.endTime).toBe('22:00');
    expect(apt.recurringSlots).toBeNull();
    expect(apt.schoolWeeksOnly).toBe(false);
    expect(apt.kidIds).toEqual(['kid1', 'kid2']);
    expect(apt.kids).toEqual([
      { age: 6, languages: ['French', 'English'] },
      { age: 4, languages: ['French'] },
    ]);
    expect(apt.offeredRate).toBe(15);
    expect(apt.additionalInfo).toBe('Two easy kids');
    expect(apt.message).toBe('I am free that evening');
    expect(apt.createdAt).toBeDefined();
    expect(apt.updatedAt).toBeDefined();

    // WITHHELD until the family accepts — the whole point of the inversion.
    expect(apt.address).toBeNull();
    expect(apt.latLng).toBeNull();
    expect(apt.pets).toBeNull();
    expect(apt.familyNote).toBeNull();
    expect(apt.familyPhotoUrl).toBeNull();
    // Kid NAMES never travel either.
    expect(JSON.stringify(apt)).not.toContain('Lucas');
  });

  it('notifies every parent of the family', async () => {
    const id = await publish();
    const res = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    const notifs = await getDb()
      .collection('notifications')
      .where('data.appointmentId', '==', res.appointmentId)
      .get();
    const recipients = notifs.docs.map((d) => d.data().recipientUserId).sort();
    expect(recipients).toEqual([seed.parent1.uid, seed.parent2.uid].sort());
    expect(notifs.docs[0].data().type).toBe('published_search_contact');
  });

  it('accepts a HIDDEN babysitter (searchable: false) — the widened audience IS the feature (#207)', async () => {
    const id = await publish();
    const res = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      hiddenToken,
    );
    const apt = (await getDb().collection('appointments').doc(res.appointmentId).get()).data()!;
    expect(apt.babysitterUserId).toBe(seed.babysitter4.uid);
    expect(apt.status).toBe('pending');
  });

  it('caps concurrent PENDING board contacts across searches, and frees a slot when one is answered', async () => {
    // The per-search dedupe + cooldown bound one pair; without a cross-search
    // ceiling one sitter could notify every family on the board, once per
    // search, each contact fanning out email + push to every parent
    // (issue #225 item 3). Five concurrent pendings is the ceiling.
    for (let i = 0; i < 5; i++) {
      await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.babysitter1.uid,
        initiatedBy: 'babysitter',
        publishedSearchId: `ps-cap-${i}`,
        status: 'pending',
      });
    }
    const id = await publish();
    await expect(
      callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED', details: { reason: 'board_contact_cap' } });

    // An ANSWER in either direction frees a slot -- the ceiling is
    // self-healing, not a punishment.
    const snap = await getDb()
      .collection('appointments')
      .where('publishedSearchId', '==', 'ps-cap-0')
      .get();
    await snap.docs[0].ref.update({ status: 'rejected', statusReason: 'declined_by_family' });
    // ps-cap-0's decline is for a DIFFERENT search, so no cooldown applies here.
    const res = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    expect(res.appointmentId).toBeTruthy();
  });

  it('rejects when the family lost verification after publishing', async () => {
    // publishSearch and sendContactRequest both gate on isFullyVerified; this
    // is the analogous match-making step, and expiry sweeps do not react to a
    // verification change (PR #212 review).
    const id = await publish();
    const db = getDb();
    const famRef = db.collection('families').doc(seed.family1Id);
    const before = (await famRef.get()).data()!;
    await famRef.update({ 'verification.isFullyVerified': false });
    try {
      await expect(
        callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    } finally {
      await famRef.set(before);
    }
  });

  it('rejects an EXPIRED published search', async () => {
    const id = await publish();
    await getDb().collection('publishedSearches').doc(id).update({
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a WITHDRAWN published search (withdraw is a delete)', async () => {
    const id = await publish();
    await getDb().collection('publishedSearches').doc(id).delete();
    await expect(
      callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a second contact for the same (search, babysitter) pair', async () => {
    const id = await publish();
    await callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken);
    await expect(
      callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('the sitter can WITHDRAW their own pending contact and then contact again', async () => {
    // The UI path the RequestDetailPage withdraw button calls (issue #207
    // PR3 review): without it the duplicate guard leaves a sitter who
    // changed their mind stuck until the family answers.
    const id = await publish();
    const first = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch', { publishedSearchId: id }, sitterToken,
    );
    await callFunction(
      'cancelAppointment',
      { appointmentId: first.appointmentId, reason: 'Withdrawn by the babysitter' },
      sitterToken,
    );
    const after = (await getDb().collection('appointments').doc(first.appointmentId).get()).data()!;
    expect(after.status).toBe('cancelled');
    // The guard counts only live contacts, so answering again is allowed.
    const second = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch', { publishedSearchId: id }, sitterToken,
    );
    expect(second.appointmentId).toBeTruthy();
    expect(second.appointmentId).not.toBe(first.appointmentId);
  });

  it('lets a DIFFERENT babysitter contact the same search', async () => {
    const id = await publish();
    await callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken);
    const res = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      hiddenToken,
    );
    expect(res.appointmentId).toBeTruthy();
  });

  // A family's "no" holds for a week (PR #212 review): without the cooldown a
  // sitter could re-mint a pending on every tap, and each one emails and
  // pushes every parent of that family. Matches the study side's spec.
  it('BLOCKS a retry while the family decline is inside the cooldown', async () => {
    const id = await publish();
    const first = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    await getDb().collection('appointments').doc(first.appointmentId).update({
      status: 'rejected',
      statusReason: 'declined_by_family',
      updatedAt: Timestamp.now(),
    });
    await expect(
      callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('lets the babysitter retry once the cooldown has elapsed', async () => {
    const id = await publish();
    const first = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    await getDb().collection('appointments').doc(first.appointmentId).update({
      status: 'rejected',
      statusReason: 'declined_by_family',
      updatedAt: Timestamp.fromMillis(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const second = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    expect(second.appointmentId).not.toBe(first.appointmentId);
  });

  it('a decline with no readable timestamp fails CLOSED (still blocked)', async () => {
    const id = await publish();
    const first = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    await getDb().collection('appointments').doc(first.appointmentId).update({
      status: 'rejected',
      statusReason: 'declined_by_family',
      updatedAt: FieldValue.delete(),
    });
    await expect(
      callFunction('contactPublishedSearch', { publishedSearchId: id }, sitterToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it("a sitter's OWN withdrawal is not a decline and starts no cooldown", async () => {
    const id = await publish();
    const first = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    await getDb().collection('appointments').doc(first.appointmentId).update({
      status: 'cancelled',
      statusReason: 'cancelled_by_babysitter',
      updatedAt: Timestamp.now(),
    });
    const second = await callFunction<{ appointmentId: string }>(
      'contactPublishedSearch',
      { publishedSearchId: id },
      sitterToken,
    );
    expect(second.appointmentId).not.toBe(first.appointmentId);
  });

  describe('age backstop (the only operative sit age gate must not be bypassable)', () => {
    it('rejects an under-15 babysitter', async () => {
      const id = await publish();
      const token = await getIdToken(UNDER_15_UID);
      await expect(
        callFunction('contactPublishedSearch', { publishedSearchId: id }, token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects a DOB/grad-year mismatch with no admin exemption', async () => {
      const id = await publish();
      const token = await getIdToken(MISMATCH_UID);
      await expect(
        callFunction('contactPublishedSearch', { publishedSearchId: id }, token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('does NOT reject a legacy profile missing its DOB', async () => {
      const id = await publish();
      const token = await getIdToken(NO_DOB_UID);
      const res = await callFunction<{ appointmentId: string }>(
        'contactPublishedSearch',
        { publishedSearchId: id },
        token,
      );
      expect(res.appointmentId).toBeTruthy();
    });
  });
});
