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
    { status = 'confirmed', date = TOMORROW(), startTime = '12:00', ...extra }: {
      status?: string; date?: string; startTime?: string;
      preSessionNote?: string; postSessionNote?: string;
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
      ...extra,
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
    { status = 'scheduled', startTime = '12:00', ...extra }: {
      status?: string; startTime?: string;
      preSessionNote?: string; postSessionNote?: string;
    } = {},
  ) {
    await instanceRef(id, date).set({
      instanceId: date, sessionId: id, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      date, startTime, endTime: '13:00', sessionLengthMinutes: 60, paddingMinutes: 0,
      subject: 'math', level: '6e', rate: 25, location: 'online',
      status, createdAt: new Date(), updatedAt: new Date(),
      ...extra,
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

  // ── Erasure carve-out (issue #255 — PARITY with sit's setAppointmentNote,
  // where the carve-out landed first in PR #253; the sit twin pins live in
  // tests/integration/appointments/set-appointment-note.test.ts and the two
  // suites must not disagree): a clear passes only the role gate — the author
  // can always erase their own note, even after the window closes or the
  // target leaves its annotatable status. Non-empty writes in those states
  // stay rejected (pinned in the timing/status gate sections above). ──

  it('the family can CLEAR a pre-note after the session has started', async () => {
    const id = await seedOneTime('ot-clear-late', {
      date: YESTERDAY(),
      preSessionNote: 'Focus on fractions',
    });
    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '' }, parent1Token);
    expect('preSessionNote' in (await sessionData(id))).toBe(false);
  });

  it('the family can CLEAR a pre-note on a cancelled session', async () => {
    const id = await seedOneTime('ot-clear-cancelled', {
      status: 'cancelled',
      preSessionNote: 'Focus on fractions',
    });
    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '' }, parent1Token);
    expect('preSessionNote' in (await sessionData(id))).toBe(false);
  });

  it('the tutor can CLEAR a post-note on a cancelled session', async () => {
    const id = await seedOneTime('ot-clear-post', {
      status: 'cancelled',
      date: YESTERDAY(),
      postSessionNote: 'debrief',
    });
    await callFunction('setSessionNote', { sessionId: id, kind: 'post', text: '' }, tutor2Token);
    expect('postSessionNote' in (await sessionData(id))).toBe(false);
  });

  it('the family can CLEAR a pre-note on a CANCELLED recurring occurrence (per-instance carve-out)', async () => {
    // Study stores recurring notes per occurrence — the carve-out must reach
    // the instance doc, not just the parent.
    const id = await seedSeries('rec-clear');
    const d = TOMORROW();
    await seedInstance(id, d, { status: 'cancelled', preSessionNote: 'stale ask' });
    await callFunction('setSessionNote', { sessionId: id, instanceId: d, kind: 'pre', text: '' }, parent1Token);
    expect('preSessionNote' in (await instanceData(id, d))).toBe(false);
  });

  it('the tutor can CLEAR a post-note on a SKIPPED occurrence', async () => {
    const id = await seedSeries('rec-clear-skip');
    const d = YESTERDAY();
    await seedInstance(id, d, { status: 'skipped', postSessionNote: 'orphaned' });
    await callFunction('setSessionNote', { sessionId: id, instanceId: d, kind: 'post', text: '' }, tutor2Token);
    expect('postSessionNote' in (await instanceData(id, d))).toBe(false);
  });

  it('a clear does NOT bump updatedAt; a content write does (mirrors sit)', async () => {
    const id = await seedOneTime('ot-clear-noresurface', {
      status: 'cancelled',
      preSessionNote: 'Focus on fractions',
    });
    const before = (await sessionData(id)).updatedAt;
    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '' }, parent1Token);
    const afterClear = await sessionData(id);
    expect('preSessionNote' in afterClear).toBe(false);
    expect(afterClear.updatedAt.toDate().getTime()).toBe(before.toDate().getTime());

    // A content write (confirmed, in-window) still bumps updatedAt.
    const id2 = await seedOneTime('ot-write-bumps');
    const before2 = (await sessionData(id2)).updatedAt;
    await callFunction('setSessionNote', { sessionId: id2, kind: 'pre', text: 'hello' }, parent1Token);
    expect((await sessionData(id2)).updatedAt.toDate().getTime()).toBeGreaterThan(
      before2.toDate().getTime(),
    );
  });

  it('a clear writes a cleared:true audit entry; a no-op clear writes none', async () => {
    // The one place the no-op early return could silently regress: it must
    // skip the audit write too, while a real clear stays accountable.
    const auditFor = async (sessionId: string) => {
      const snap = await getDb().collection('auditLogs').get();
      return snap.docs
        .map((d) => d.data())
        .filter((a) => a.action === 'session_note_set' && a.details?.sessionId === sessionId);
    };

    const id = await seedOneTime('ot-clear-audit', {
      status: 'cancelled',
      preSessionNote: 'Focus on fractions',
    });
    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '' }, parent1Token);
    const entries = await auditFor(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toMatchObject({ kind: 'pre', cleared: true });

    const id2 = await seedOneTime('ot-noop-audit', { status: 'cancelled' });
    await callFunction('setSessionNote', { sessionId: id2, kind: 'pre', text: '' }, parent1Token);
    expect(await auditFor(id2)).toHaveLength(0);
  });

  it('a no-op clear (nothing stored) succeeds without touching the doc', async () => {
    const id = await seedOneTime('ot-noop-clear', { status: 'cancelled' });
    const before = (await sessionData(id)).updatedAt;
    const res = await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '' }, parent1Token);
    expect(res).toMatchObject({ success: true });
    const after = await sessionData(id);
    expect('preSessionNote' in after).toBe(false);
    expect(after.updatedAt.toDate().getTime()).toBe(before.toDate().getTime());
  });

  it('a clear is still author-only: a stranger cannot clear (permission-denied)', async () => {
    const id = await seedOneTime('ot-clear-stranger', {
      date: YESTERDAY(),
      preSessionNote: 'Focus on fractions',
    });
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await sessionData(id)).preSessionNote).toBe('Focus on fractions');
  });

  it('whitespace-only text also clears (input is trimmed)', async () => {
    const id = await seedOneTime('ot-trim');
    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '  padded  ' }, parent1Token);
    expect((await sessionData(id)).preSessionNote).toBe('padded');

    await callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: '   ' }, parent1Token);
    expect('preSessionNote' in (await sessionData(id))).toBe(false);
  });

  it('a NON-EMPTY write is still rejected after start — only clears pass the carve-out', async () => {
    const id = await seedOneTime('ot-late-rewrite', {
      date: YESTERDAY(),
      preSessionNote: 'old',
    });
    await expect(
      callFunction('setSessionNote', { sessionId: id, kind: 'pre', text: 'new ask' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    expect((await sessionData(id)).preSessionNote).toBe('old');
  });

  it('a NON-EMPTY write is still rejected on a cancelled occurrence — the instance gates hold too', async () => {
    const id = await seedSeries('rec-late-rewrite');
    const d = TOMORROW();
    await seedInstance(id, d, { status: 'cancelled', preSessionNote: 'old' });
    await expect(
      callFunction('setSessionNote', { sessionId: id, instanceId: d, kind: 'pre', text: 'new ask' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    expect((await instanceData(id, d)).preSessionNote).toBe('old');
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
