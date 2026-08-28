import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Fixed far-future Monday matching tutor2's weekly grid (Mon 16:00–20:00 →
// slots 64..79 true). Far enough out that the 24h notice never trips.
const FUTURE_MON = '2027-06-07';

// Paris date+startTime ~hours from now, aligned to a 15-min slot (stale-notice).
function parisNear(hoursFromNow: number): { date: string; startTime: string; endTime: string } {
  const target = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(target)) p[part.type] = part.value;
  const slot = Math.floor((Number(p.hour) * 60 + Number(p.minute)) / 15);
  const hhmm = (s: number) => `${String(Math.floor((s * 15) / 60) % 24).padStart(2, '0')}:${String((s * 15) % 60).padStart(2, '0')}`;
  return { date: `${p.year}-${p.month}-${p.day}`, startTime: hhmm(slot), endTime: hhmm(slot + 4) };
}

describe('respondToSession — provider proposals (family confirms the claim)', () => {
  let seed: SeedData;
  let parent1Token: string; // family1 (Dupont) — the proposed-to family
  let parent3Token: string; // family2 (Martin) — an unrelated family
  let tutor2Token: string; // the proposing tutor

  interface ProposalOverrides {
    sessionId?: string;
    familyId?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    paddingMinutes?: number;
    status?: string;
    /** Omit proposedBy entirely → a LEGACY family-initiated doc. */
    legacy?: boolean;
  }

  /** Seed a provider proposal (studentIds/parentName filled only at accept). A
   * legacy doc (over.legacy) omits proposedBy and carries a family roster, exactly
   * like a pre-feature family-initiated request. */
  async function seedProposal(over: ProposalOverrides = {}): Promise<string> {
    const db = getDb();
    const id = over.sessionId ?? `prop-${Math.random().toString(36).slice(2, 9)}`;
    const doc: Record<string, unknown> = {
      sessionId: id,
      tutorUserId: seed.tutor2.uid,
      familyId: over.familyId ?? seed.family1Id,
      createdByUserId: over.legacy ? seed.parent1.uid : seed.tutor2.uid,
      subject: 'math', level: '6e', rate: 25,
      studentIds: over.legacy ? ['kid1'] : [],
      students: over.legacy ? [{ firstName: 'Lucas', age: 6 }] : [],
      familyName: 'Dupont',
      parentName: over.legacy ? 'Marie Dupont' : '',
      tutorName: 'Yael Cohen',
      type: 'one_time',
      date: over.date ?? FUTURE_MON,
      startTime: over.startTime ?? '16:00',
      endTime: over.endTime ?? '17:00',
      sessionLengthMinutes: 60,
      location: over.location ?? 'online',
      paddingMinutes: over.paddingMinutes ?? 15,
      status: over.status ?? 'pending',
      createdAt: new Date(), updatedAt: new Date(),
    };
    if (!over.legacy) doc.proposedBy = 'provider';
    await db.collection('study-sessions').doc(id).set(doc);
    return id;
  }

  const overrideRef = () =>
    getDb().collection('schedules').doc(seed.tutor2.uid).collection('overrides').doc(FUTURE_MON);

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
      'notifPrefs.confirmed': { push: true, email: true },
      'notifPrefs.cancelled': { push: true, email: true },
    });
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
  });

  // ── Family confirm: the claim, with student picking + parentName denorm ──

  it('lets the family confirm a proposal — claims the slot and denormalizes chosen students', async () => {
    const db = getDb();
    const id = await seedProposal();

    const res = await callFunction(
      'respondToSession',
      { sessionId: id, action: 'confirm', studentIds: ['kid1', 'kid2'] },
      parent1Token,
    );
    expect(res).toMatchObject({ success: true });

    const session = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(session.status).toBe('confirmed');
    expect(session.confirmedAt).toBeTruthy();
    // Students + parentName denormalized from the accepting family at confirm.
    expect(session.studentIds).toEqual(['kid1', 'kid2']);
    expect(session.students).toEqual([
      { firstName: 'Lucas', age: 6 },
      { firstName: 'Emma', age: 4 },
    ]);
    expect(session.parentName).toBe('Marie Dupont');
    // The confirming parent's uid rides along with their name — on a proposal
    // createdByUserId is the TUTOR, so without this stamp the name would be
    // unattributable to the identity-correction fan-out (issue #273).
    expect(session.parentUserId).toBe(seed.parent1.uid);

    // Same claim as a tutor confirm: online → slots 64..67 blocked, ledger entry.
    const ov = (await overrideRef().get()).data()!;
    expect(ov.slots[64]).toBe(false);
    expect(ov.slots[67]).toBe(false);
    expect(ov.slots[68]).toBe(true);
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);
  });

  // ── THE SELF-CONFIRM GUARD (the consent hole) ──

  it('REJECTS the proposing tutor confirming their own proposal (self-confirm guard)', async () => {
    const id = await seedProposal();
    await expect(
      callFunction(
        'respondToSession',
        { sessionId: id, action: 'confirm', studentIds: ['kid1'] },
        tutor2Token,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // Still pending — no fabricated consent.
    expect((await getDb().collection('study-sessions').doc(id).get()).data()!.status).toBe('pending');
  });

  it('REJECTS the proposing tutor declining their own proposal (never the proposer)', async () => {
    const id = await seedProposal();
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'decline' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unrelated family with permission-denied', async () => {
    const id = await seedProposal();
    await expect(
      callFunction(
        'respondToSession',
        { sessionId: id, action: 'confirm', studentIds: ['kid4'] },
        parent3Token,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  // ── Confirm requires student selection ──

  it('rejects confirming a proposal with no studentIds (invalid-argument)', async () => {
    const id = await seedProposal();
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await getDb().collection('study-sessions').doc(id).get()).data()!.status).toBe('pending');
  });

  it('rejects confirming with a student from another family (not-found)', async () => {
    // kid4 belongs to family2 (Martin), not the accepting family1.
    const id = await seedProposal();
    await expect(
      callFunction(
        'respondToSession',
        { sessionId: id, action: 'confirm', studentIds: ['kid4'] },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Stale-notice re-check at confirm ──

  it('rejects confirming a proposal now inside the 24h window (failed-precondition)', async () => {
    const near = parisNear(2);
    const id = await seedProposal(near);
    await expect(
      callFunction(
        'respondToSession',
        { sessionId: id, action: 'confirm', studentIds: ['kid1'] },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Slot taken between propose and confirm ──

  it('slot taken between propose and confirm → failed-precondition, still pending, NO override delta', async () => {
    const db = getDb();
    // A foreign override on the date, with a recognizable marker + empty ledger.
    const slots = new Array(96).fill(true);
    await overrideRef().set({
      date: FUTURE_MON, type: 'custom', slots, sessionBlocks: [],
      reason: 'manual_block', appointmentId: 'apt-marker', createdAt: new Date(),
    });
    // A confirmed session grabbed the slot AFTER the proposal was made.
    await db.collection('study-sessions').doc('blocker').set({
      sessionId: 'blocker', tutorUserId: seed.tutor2.uid, familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid4'], students: [{ firstName: 'Chloe', age: 7 }],
      familyName: 'Martin', parentName: 'Sophie Martin', tutorName: 'Yael Cohen',
      type: 'one_time', date: FUTURE_MON, startTime: '16:00', endTime: '17:00',
      sessionLengthMinutes: 60, location: 'online', paddingMinutes: 15,
      status: 'confirmed', createdAt: new Date(), updatedAt: new Date(),
    });

    const id = await seedProposal({ startTime: '16:00', endTime: '17:00' });
    await expect(
      callFunction(
        'respondToSession',
        { sessionId: id, action: 'confirm', studentIds: ['kid1'] },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION', message: 'This time is no longer available' });

    // Proposal untouched.
    expect((await db.collection('study-sessions').doc(id).get()).data()!.status).toBe('pending');
    // Override doc has NO delta — the failed claim rolled back, marker intact.
    const ov = (await overrideRef().get()).data()!;
    expect(ov.appointmentId).toBe('apt-marker');
    expect(ov.sessionBlocks).toEqual([]);
    expect(ov.slots.every((s: boolean) => s === true)).toBe(true);
  });

  // ── Decline ──

  it('declines a proposal with reason declined_by_family and writes NO override', async () => {
    const db = getDb();
    const id = await seedProposal();
    const res = await callFunction('respondToSession', { sessionId: id, action: 'decline' }, parent1Token);
    expect(res).toMatchObject({ success: true });
    const session = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(session.status).toBe('declined');
    expect(session.statusReason).toBe('declined_by_family');
    expect((await overrideRef().get()).exists).toBe(false);
  });

  // ── Notifications go TO the tutor ──

  it('notifies the tutor when the family confirms a proposal', async () => {
    const db = getDb();
    const id = await seedProposal();
    await callFunction(
      'respondToSession',
      { sessionId: id, action: 'confirm', studentIds: ['kid1'] },
      parent1Token,
    );
    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid).get();
    expect(notifs.docs.some((d) => d.data().type === 'study_session_confirmed')).toBe(true);
  });

  it('notifies the tutor when the family declines a proposal', async () => {
    const db = getDb();
    const id = await seedProposal();
    await callFunction('respondToSession', { sessionId: id, action: 'decline' }, parent1Token);
    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid).get();
    expect(notifs.docs.some((d) => d.data().type === 'study_session_declined')).toBe(true);
  });

  // ── Auto-decline sweep (proposedBy-agnostic), both directions ──

  it('confirming a proposal auto-declines an overlapping family-initiated pending', async () => {
    const db = getDb();
    const target = await seedProposal({ startTime: '16:00', endTime: '17:00' });
    const famreq = await seedProposal({
      sessionId: 'famreq', familyId: seed.family2Id, legacy: true,
      startTime: '16:30', endTime: '17:30',
    });
    await callFunction(
      'respondToSession',
      { sessionId: target, action: 'confirm', studentIds: ['kid1'] },
      parent1Token,
    );
    const bumped = (await db.collection('study-sessions').doc(famreq).get()).data()!;
    expect(bumped.status).toBe('declined');
    expect(bumped.statusReason).toBe('slot_taken');
  });

  it('confirming a family request auto-declines an overlapping provider proposal', async () => {
    const db = getDb();
    const famreq = await seedProposal({
      sessionId: 'famreq2', legacy: true, startTime: '16:00', endTime: '17:00',
    });
    const prop = await seedProposal({
      sessionId: 'prop2', familyId: seed.family2Id, startTime: '16:30', endTime: '17:30',
    });
    // The tutor confirms the family-initiated request the normal way.
    await callFunction('respondToSession', { sessionId: famreq, action: 'confirm' }, tutor2Token);
    const bumped = (await db.collection('study-sessions').doc(prop).get()).data()!;
    expect(bumped.status).toBe('declined');
    expect(bumped.statusReason).toBe('slot_taken');
  });

  // ── LEGACY doc regression (no proposedBy → family respond rejected, tutor works) ──

  it('legacy doc (no proposedBy): family respond is rejected', async () => {
    const id = await seedProposal({ legacy: true });
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('legacy doc (no proposedBy): tutor respond confirms as before', async () => {
    const db = getDb();
    const id = await seedProposal({ legacy: true });
    const res = await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);
    expect(res).toMatchObject({ success: true });
    const session = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(session.status).toBe('confirmed');
    // The pre-existing family roster is preserved (tutor confirm doesn't touch it).
    expect(session.studentIds).toEqual(['kid1']);
    const ov = (await overrideRef().get()).data()!;
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);
  });
});
