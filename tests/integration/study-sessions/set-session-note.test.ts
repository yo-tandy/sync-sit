import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// ── Dynamic Paris wall-clock fixtures (DST-safe): build past-started vs future
// sessions relative to *now* rather than hard-coding calendar dates, so the
// timing gates (parisWallTimeToUtc) are exercised against a real window. ──
function parisDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
const DAY = 24 * 60 * 60 * 1000;
/** Paris calendar date N days from now (negative = past). Noon-anchored offset
 * dominates any DST hour shift, so a ±1-day session is unambiguously past/future. */
function dateOffset(days: number): string {
  return parisDateOf(new Date(Date.now() + days * DAY));
}
const YESTERDAY = () => dateOffset(-1);
const TOMORROW = () => dateOffset(1);
const DAY_AFTER = () => dateOffset(2);

describe('setSessionNote', () => {
  let seed: SeedData;
  let parent1Token: string; // a parent of the session's family (family1)
  let parent3Token: string; // a stranger (other family)
  let tutor2Token: string; // the session's owning tutor

  const sessionRef = (id: string) => getDb().collection('study-sessions').doc(id);
  const sessionData = async (id: string) => (await sessionRef(id).get()).data()!;
  const instanceRef = (id: string, date: string) =>
    sessionRef(id).collection('instances').doc(date);
  const instanceData = async (id: string, date: string) =>
    (await instanceRef(id, date).get()).data()!;

  /** A one_time session (family1 / tutor2). Defaults to a confirmed, future date. */
  async function seedOneTime(
    id: string,
    { status = 'confirmed', date = TOMORROW(), startTime = '12:00' }: {
      status?: string; date?: string; startTime?: string;
    } = {},
  ) {
    await sessionRef(id).set({
      sessionId: id, familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'one_time', date, startTime, endTime: '13:00', sessionLengthMinutes: 60,
      location: 'online', paddingMinutes: 0,
      status, createdAt: new Date(), updatedAt: new Date(), confirmedAt: new Date(),
    });
    return id;
  }

  /** A confirmed recurring parent (family1 / tutor2), no instances yet. */
  async function seedSeries(id: string) {
    await sessionRef(id).set({
      sessionId: id, familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'recurring', startTime: '12:00', sessionLengthMinutes: 60,
      recurringSlots: [{ day: 'mon', startTime: '12:00', endTime: '13:00' }],
      schoolWeeksOnly: true, location: 'online', paddingMinutes: 0,
      status: 'confirmed', createdAt: new Date(), updatedAt: new Date(), confirmedAt: new Date(),
    });
    return id;
  }

  async function seedInstance(
    id: string, date: string,
    { status = 'scheduled', startTime = '12:00' }: { status?: string; startTime?: string } = {},
  ) {
    await instanceRef(id, date).set({
      instanceId: date, sessionId: id, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      date, startTime, endTime: '13:00', sessionLengthMinutes: 60, paddingMinutes: 0,
      subject: 'math', level: '6e', rate: 25, location: 'online',
      status, createdAt: new Date(), updatedAt: new Date(),
    });
  }

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
    const inst = await db.collectionGroup('instances').get();
    await Promise.all(inst.docs.map((d) => d.ref.delete()));
    const snap = await db.collection('study-sessions').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  });

  // ── Happy paths ──

  it('family sets a pre-note on an upcoming one_time session', async () => {
    const id = await seedOneTime('ot-pre');
    const res = await callFunction('setSessionNote',
      { sessionId: id, kind: 'pre', text: 'Please focus on fractions this week.' }, parent1Token);
    expect(res).toMatchObject({ success: true });
    expect((await sessionData(id)).preSessionNote).toBe('Please focus on fractions this week.');
  });

  it('tutor sets a post-note on a one_time session that has started', async () => {
    const id = await seedOneTime('ot-post', { date: YESTERDAY() });
    const res = await callFunction('setSessionNote',
      { sessionId: id, kind: 'post', text: 'Covered long division; homework p.42.' }, tutor2Token);
    expect(res).toMatchObject({ success: true });
    expect((await sessionData(id)).postSessionNote).toBe('Covered long division; homework p.42.');
  });

  it('post-note on a completed one_time session is allowed', async () => {
    const id = await seedOneTime('ot-completed', { status: 'completed', date: YESTERDAY() });
    await callFunction('setSessionNote',
      { sessionId: id, kind: 'post', text: 'Wrapped up.' }, tutor2Token);
    expect((await sessionData(id)).postSessionNote).toBe('Wrapped up.');
  });

  // ── Role gates ──

  it('tutor cannot set the pre-note (permission-denied)', async () => {
    const id = await seedOneTime('ot-role1');
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'x' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('family cannot set the post-note (permission-denied)', async () => {
    const id = await seedOneTime('ot-role2', { date: YESTERDAY() });
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'post', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('a stranger (other family) cannot set the pre-note (permission-denied)', async () => {
    const id = await seedOneTime('ot-role3');
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'x' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  // ── Timing gates ──

  it('pre-note rejected once the session has started (failed-precondition)', async () => {
    const id = await seedOneTime('ot-late-pre', { date: YESTERDAY() });
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'too late' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('post-note rejected before the session has started (failed-precondition)', async () => {
    const id = await seedOneTime('ot-early-post');
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'post', text: 'too early' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Status gates ──

  it('rejects a cancelled target (failed-precondition)', async () => {
    const id = await seedOneTime('ot-cancelled', { status: 'cancelled' });
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a pending target — nothing to annotate (failed-precondition)', async () => {
    const id = await seedOneTime('ot-pending', { status: 'pending' });
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Not-found / argument shape ──

  it('rejects an unknown session with not-found', async () => {
    await expect(
      callFunction('setSessionNote', { sessionId: 'nope', kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an instanceId on a one_time session (invalid-argument)', async () => {
    const id = await seedOneTime('ot-badinst');
    await expect(
      callFunction('setSessionNote',
        { sessionId: id, instanceId: TOMORROW(), kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a recurring series without an instanceId (invalid-argument)', async () => {
    const id = await seedSeries('rec-noinst');
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an unknown recurring instance with not-found', async () => {
    const id = await seedSeries('rec-badinst');
    await expect(
      callFunction('setSessionNote',
        { sessionId: id, instanceId: TOMORROW(), kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── Recurring instance targeting ──

  it('a note on one instance does not touch the sibling instance or the parent', async () => {
    const id = await seedSeries('rec-target');
    const d1 = TOMORROW();
    const d2 = DAY_AFTER();
    await seedInstance(id, d1);
    await seedInstance(id, d2);

    await callFunction('setSessionNote',
      { sessionId: id, instanceId: d2, kind: 'pre', text: 'note on the second occurrence' }, parent1Token);

    expect((await instanceData(id, d2)).preSessionNote).toBe('note on the second occurrence');
    expect((await instanceData(id, d1)).preSessionNote).toBeUndefined();
    expect((await sessionData(id)).preSessionNote).toBeUndefined();
  });

  it('tutor sets a post-note on a started recurring occurrence', async () => {
    const id = await seedSeries('rec-post');
    const d = YESTERDAY();
    await seedInstance(id, d);
    await callFunction('setSessionNote',
      { sessionId: id, instanceId: d, kind: 'post', text: 'went well' }, tutor2Token);
    expect((await instanceData(id, d)).postSessionNote).toBe('went well');
  });

  // ── Clear-by-emptying (field goes ABSENT, not blank) ──

  it('empty text clears the note (field is deleted)', async () => {
    const id = await seedOneTime('ot-clear');
    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'first draft' }, parent1Token);
    expect((await sessionData(id)).preSessionNote).toBe('first draft');

    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '' }, parent1Token);
    const after = await sessionData(id);
    expect('preSessionNote' in after).toBe(false);
    expect(after.preSessionNote).toBeUndefined();
  });

  // ── Length bound ──

  it('rejects text longer than 2000 chars (invalid-argument)', async () => {
    const id = await seedOneTime('ot-toolong');
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'a'.repeat(2001) }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('accepts text exactly 2000 chars', async () => {
    const id = await seedOneTime('ot-max');
    const text = 'a'.repeat(2000);
    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text }, parent1Token);
    expect((await sessionData(id)).preSessionNote).toBe(text);
  });
});
