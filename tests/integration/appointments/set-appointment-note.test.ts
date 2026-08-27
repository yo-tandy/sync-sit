import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

// Mirrors study's set-session-note.test.ts one-for-one, adapted to sit's
// appointment model (issue #238, parity B2): no per-occurrence instances (so
// study's instanceId-shape pins become the recurring-doc pins), no
// 'completed' status (a past sitting stays 'confirmed'), field names
// preAppointmentNote / postAppointmentNote.

// ── Dynamic Paris wall-clock fixtures (DST-safe): build past-started vs
// future appointments relative to *now* rather than hard-coding calendar
// dates, so the timing gates (parisWallTimeToUtc) are exercised against a
// real window. ──
function parisDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
const DAY = 24 * 60 * 60 * 1000;
/** Paris calendar date N days from now (negative = past). Noon-anchored offset
 * dominates any DST hour shift, so a ±1-day appointment is unambiguously
 * past/future. */
function dateOffset(days: number): string {
  return parisDateOf(new Date(Date.now() + days * DAY));
}
const YESTERDAY = () => dateOffset(-1);
const TOMORROW = () => dateOffset(1);
const WEEK_AGO = () => dateOffset(-7);

describe('setAppointmentNote', () => {
  let seed: SeedData;
  let parent1Token: string; // a parent of the appointment's family (family1)
  let parent3Token: string; // a stranger (other family)
  let babysitter1Token: string; // the appointment's babysitter
  let babysitter2Token: string; // a stranger babysitter

  const aptRef = (id: string) => getDb().collection('appointments').doc(id);
  const aptData = async (id: string) => (await aptRef(id).get()).data()!;

  /** A one_time appointment (family1 / babysitter1). Defaults to a confirmed,
   * future date at noon. */
  async function seedOneTime(
    id: string,
    { status = 'confirmed', date = TOMORROW(), startTime = '12:00', preAppointmentNote, postAppointmentNote }: {
      status?: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
      date?: string; startTime?: string;
      preAppointmentNote?: string; postAppointmentNote?: string;
    } = {},
  ) {
    await seedAppointment({
      appointmentId: id,
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status,
      date,
      startTime,
      endTime: '13:00',
      ...(preAppointmentNote !== undefined ? { preAppointmentNote } : {}),
      ...(postAppointmentNote !== undefined ? { postAppointmentNote } : {}),
    });
    return id;
  }

  /** A confirmed RECURRING appointment (family1 / babysitter1): one ongoing
   * doc — no date, no per-occurrence instances (sit's shape). */
  async function seedRecurring(id: string, status = 'confirmed') {
    await aptRef(id).set({
      appointmentId: id,
      searchId: null,
      familyId: seed.family1Id,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      type: 'recurring',
      status,
      recurringSlots: [{ day: 'mon', startTime: '18:00', endTime: '20:00' }],
      schoolWeeksOnly: true,
      kidIds: ['kid1'],
      kids: [{ age: 6, languages: ['French'] }],
      address: '15 Rue de Passy, 75016 Paris',
      latLng: { lat: 48.8566, lng: 2.2769 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    babysitter1Token = await getIdToken(seed.babysitter1.uid);
    babysitter2Token = await getIdToken(seed.babysitter2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const snap = await getDb().collection('appointments').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  });

  // ── Happy paths ──

  it('family sets a pre-note on an upcoming confirmed one_time appointment', async () => {
    const id = await seedOneTime('ot-pre');
    const res = await callFunction('setAppointmentNote',
      { appointmentId: id, kind: 'pre', text: 'Door code 1234B. Bedtime is 20:30.' }, parent1Token);
    expect(res).toMatchObject({ success: true });
    expect((await aptData(id)).preAppointmentNote).toBe('Door code 1234B. Bedtime is 20:30.');
  });

  it('babysitter sets a post-note on a one_time appointment that has started', async () => {
    const id = await seedOneTime('ot-post', { date: YESTERDAY() });
    const res = await callFunction('setAppointmentNote',
      { appointmentId: id, kind: 'post', text: 'All went well; kids asleep by 21:00.' }, babysitter1Token);
    expect(res).toMatchObject({ success: true });
    expect((await aptData(id)).postAppointmentNote).toBe('All went well; kids asleep by 21:00.');
  });

  it('post-note on a long-past confirmed one_time is allowed (sit analog of study\'s completed pin)', async () => {
    const id = await seedOneTime('ot-past', { date: WEEK_AGO() });
    await callFunction('setAppointmentNote',
      { appointmentId: id, kind: 'post', text: 'Wrapped up.' }, babysitter1Token);
    expect((await aptData(id)).postAppointmentNote).toBe('Wrapped up.');
  });

  it('rejects an unauthenticated caller', async () => {
    const id = await seedOneTime('ot-noauth');
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  // ── Role gates ──

  it('babysitter cannot set the pre-note (permission-denied)', async () => {
    const id = await seedOneTime('ot-role1');
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, babysitter1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('family cannot set the post-note (permission-denied)', async () => {
    const id = await seedOneTime('ot-role2', { date: YESTERDAY() });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'post', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('a stranger (other family) cannot set the pre-note (permission-denied)', async () => {
    const id = await seedOneTime('ot-role3');
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('a stranger babysitter cannot set the post-note (permission-denied)', async () => {
    const id = await seedOneTime('ot-role4', { date: YESTERDAY() });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'post', text: 'x' }, babysitter2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('an ACTIVE guardian of the babysitter cannot write either note (no guardian branch)', async () => {
    // parent3's family actively supervises babysitter1 — cancelAppointment
    // would let them act for the sitter, but setAppointmentNote deliberately
    // has NO guardian branch (mirrors study). The guardian reads notes via
    // getGovernedChildDetail; they never author them.
    await getDb().collection('guardianLinks').doc(seed.babysitter1.uid).set({
      childUid: seed.babysitter1.uid,
      familyId: seed.parent3.familyId,
      createdByParentUid: seed.parent3.uid,
      status: 'active',
      origin: 'parent_created',
      requestedAt: new Date(),
      confirmedAt: new Date(),
    });
    try {
      const id = await seedOneTime('ot-guardian', { date: YESTERDAY() });
      await expect(
        callFunction('setAppointmentNote', { appointmentId: id, kind: 'post', text: 'x' }, parent3Token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(
        callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, parent3Token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    } finally {
      await getDb().collection('guardianLinks').doc(seed.babysitter1.uid).delete();
    }
  });

  // ── Timing gates (one_time) ──

  it('pre-note rejected once the appointment has started (failed-precondition)', async () => {
    const id = await seedOneTime('ot-late-pre', { date: YESTERDAY() });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'too late' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('post-note rejected before the appointment has started (failed-precondition)', async () => {
    const id = await seedOneTime('ot-early-post');
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'post', text: 'too early' }, babysitter1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Status gates ──

  it('rejects a cancelled appointment (failed-precondition)', async () => {
    const id = await seedOneTime('ot-cancelled', { status: 'cancelled' });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a pending appointment — nothing to annotate (failed-precondition)', async () => {
    const id = await seedOneTime('ot-pending', { status: 'pending' });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a rejected appointment (failed-precondition)', async () => {
    const id = await seedOneTime('ot-rejected', { status: 'rejected' });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Not-found / argument shape ──

  it('rejects an unknown appointment with not-found', async () => {
    await expect(
      callFunction('setAppointmentNote', { appointmentId: 'nope', kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an invalid kind (invalid-argument)', async () => {
    const id = await seedOneTime('ot-badkind');
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'during', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── Recurring: one ongoing doc, both windows open while confirmed ──
  // (Replaces study's instanceId-shape pins: sit has no per-occurrence
  // instances, so a recurring appointment's notes live on its single doc and
  // there is no single start instant to gate on.)

  it('family sets a pre-note on a confirmed recurring appointment (no date, no timing gate)', async () => {
    const id = await seedRecurring('rec-pre');
    await callFunction('setAppointmentNote',
      { appointmentId: id, kind: 'pre', text: 'Allergies: peanuts. Door code 4321.' }, parent1Token);
    expect((await aptData(id)).preAppointmentNote).toBe('Allergies: peanuts. Door code 4321.');
  });

  it('babysitter sets a post-note on a confirmed recurring appointment (no timing gate)', async () => {
    const id = await seedRecurring('rec-post');
    await callFunction('setAppointmentNote',
      { appointmentId: id, kind: 'post', text: 'Mondays are going great.' }, babysitter1Token);
    expect((await aptData(id)).postAppointmentNote).toBe('Mondays are going great.');
  });

  it('an absent/unknown type fails CLOSED into the strict one_time windows', async () => {
    // Only an explicit 'recurring' doc earns the both-windows-open exemption:
    // a doc with no type at all gets the timing gates, so a started target
    // still rejects the pre-note.
    const id = 'ot-notype';
    await seedOneTime(id, { date: YESTERDAY() });
    await aptRef(id).update({ type: FieldValue.delete() });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('role gates still apply on recurring: stranger family denied', async () => {
    const id = await seedRecurring('rec-role');
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'x' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  // ── Note independence (adapts study's "one instance does not touch its
  // sibling or the parent" pin: the two kinds share a doc but not a field) ──

  it('writing the post-note preserves an existing pre-note (and vice versa)', async () => {
    const id = await seedRecurring('rec-both');
    await callFunction('setAppointmentNote',
      { appointmentId: id, kind: 'pre', text: 'pre note' }, parent1Token);
    await callFunction('setAppointmentNote',
      { appointmentId: id, kind: 'post', text: 'post note' }, babysitter1Token);
    const after = await aptData(id);
    expect(after.preAppointmentNote).toBe('pre note');
    expect(after.postAppointmentNote).toBe('post note');
  });

  // ── Clear-by-emptying (field goes ABSENT, not blank) ──

  it('empty text clears the note (field is deleted)', async () => {
    const id = await seedOneTime('ot-clear');
    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'first draft' }, parent1Token);
    expect((await aptData(id)).preAppointmentNote).toBe('first draft');

    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: '' }, parent1Token);
    const after = await aptData(id);
    expect('preAppointmentNote' in after).toBe(false);
    expect(after.preAppointmentNote).toBeUndefined();
  });

  it('whitespace-only text also clears (input is trimmed)', async () => {
    const id = await seedOneTime('ot-trim');
    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: '  padded  ' }, parent1Token);
    expect((await aptData(id)).preAppointmentNote).toBe('padded');

    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: '   ' }, parent1Token);
    expect('preAppointmentNote' in (await aptData(id))).toBe(false);
  });

  // ── Erasure carve-out (DELIBERATE divergence from study, issue #255):
  // a clear passes only the role gate — the author can always erase their
  // own note, even after the window closes or the appointment leaves
  // 'confirmed'. Non-empty writes in those states stay rejected (pinned in
  // the timing/status gate sections above).

  it('the family can CLEAR a pre-note after the sitting has started', async () => {
    const id = await seedOneTime('ot-clear-late', {
      date: YESTERDAY(),
      preAppointmentNote: 'Door code 1234B',
    });
    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: '' }, parent1Token);
    expect('preAppointmentNote' in (await aptData(id))).toBe(false);
  });

  it('the family can CLEAR a pre-note on a cancelled appointment', async () => {
    const id = await seedOneTime('ot-clear-cancelled', {
      status: 'cancelled',
      preAppointmentNote: 'Door code 1234B',
    });
    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: '' }, parent1Token);
    expect('preAppointmentNote' in (await aptData(id))).toBe(false);
  });

  it('the babysitter can CLEAR a post-note on a cancelled appointment', async () => {
    const id = await seedOneTime('ot-clear-post', {
      status: 'cancelled',
      date: YESTERDAY(),
      postAppointmentNote: 'debrief',
    });
    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'post', text: '' }, babysitter1Token);
    expect('postAppointmentNote' in (await aptData(id))).toBe(false);
  });

  it('the family can CLEAR a pre-note on a pending appointment (carve-out covers every status)', async () => {
    // A note can only land on a pending doc via odd histories (e.g. admin
    // edits), but the carve-out is status-blind by design: erasure is never
    // refused to the author.
    const id = await seedOneTime('ot-clear-pending', {
      status: 'pending',
      preAppointmentNote: 'stale',
    });
    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: '' }, parent1Token);
    expect('preAppointmentNote' in (await aptData(id))).toBe(false);
  });

  it('a clear is still author-only: a stranger cannot clear (permission-denied)', async () => {
    const id = await seedOneTime('ot-clear-stranger', {
      date: YESTERDAY(),
      preAppointmentNote: 'Door code 1234B',
    });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: '' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await aptData(id)).preAppointmentNote).toBe('Door code 1234B');
  });

  it('a NON-EMPTY write is still rejected after start — only clears pass the carve-out', async () => {
    const id = await seedOneTime('ot-late-rewrite', {
      date: YESTERDAY(),
      preAppointmentNote: 'old',
    });
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'new code 9999' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    expect((await aptData(id)).preAppointmentNote).toBe('old');
  });

  // ── Length bound ──

  it('rejects text longer than 2000 chars (invalid-argument)', async () => {
    const id = await seedOneTime('ot-toolong');
    await expect(
      callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text: 'a'.repeat(2001) }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('accepts text exactly 2000 chars', async () => {
    const id = await seedOneTime('ot-max');
    const text = 'a'.repeat(2000);
    await callFunction('setAppointmentNote', { appointmentId: id, kind: 'pre', text }, parent1Token);
    expect((await aptData(id)).preAppointmentNote).toBe(text);
  });
});
