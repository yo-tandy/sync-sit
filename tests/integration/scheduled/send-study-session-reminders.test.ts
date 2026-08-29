import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const require = createRequire(import.meta.url);
// Imported after `pnpm --filter study-functions build`.
const { runSendStudySessionReminders } = require(
  '../../../apps/study-functions/dist/scheduled/sendStudySessionReminders.js',
) as typeof import('../../../apps/study-functions/src/scheduled/sendStudySessionReminders.js');

// Injected clock: 2026-07-15T10:00Z = 12:00 Paris (CEST). All seed times are
// Paris wall-clock. On 2026-07-16: 12:00 → 24h out (reminded), 10:00 → 22h out,
// 14:00 → 26h out.
const NOW = new Date('2026-07-15T10:00:00Z');
const TOMORROW = '2026-07-16';

describe('runSendStudySessionReminders', () => {
  let seed: SeedData;

  const ssRef = (id: string) => getDb().collection('study-sessions').doc(id);
  const instRef = (parentId: string, date: string) =>
    ssRef(parentId).collection('instances').doc(date);

  async function seedOneTime(
    id: string,
    opts: { startTime: string; status?: string; date?: string },
  ) {
    await ssRef(id).set({
      sessionId: id, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'one_time', date: opts.date ?? TOMORROW, startTime: opts.startTime,
      endTime: '13:00', sessionLengthMinutes: 60, location: 'online', paddingMinutes: 0,
      status: opts.status ?? 'confirmed', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  async function seedRecurringWithInstance(
    parentId: string,
    opts: { startTime: string; instanceStatus?: string; date?: string },
  ) {
    await ssRef(parentId).set({
      sessionId: parentId, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid, subject: 'english', level: '6e', rate: 22,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'recurring', startTime: opts.startTime, sessionLengthMinutes: 60,
      recurringSlots: [{ day: 'thu', startTime: opts.startTime, endTime: '13:00' }],
      location: 'online', paddingMinutes: 0, status: 'confirmed',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const date = opts.date ?? TOMORROW;
    await instRef(parentId, date).set({
      instanceId: date, sessionId: parentId, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      date, startTime: opts.startTime, endTime: '13:00', sessionLengthMinutes: 60, paddingMinutes: 0,
      subject: 'english', level: '6e', rate: 22, location: 'online',
      status: opts.instanceStatus ?? 'scheduled', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  const notifsFor = async (uid: string) =>
    (await getDb().collection('notifications').where('recipientUserId', '==', uid).get()).docs.map((d) => d.data());

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const inst = await db.collectionGroup('instances').get();
    await Promise.all(inst.docs.map((d) => d.ref.delete()));
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    // Reset reminders prefs the prefs-gating test mutates.
    await db.collection('users').doc(seed.parent1.uid).update({
      'notifPrefs.shared.reminders': { push: true, email: true },
    });
  });

  // ── Window boundaries (22h no / 24h yes / 26h no) ──

  it('reminds only sessions 23-25h out', async () => {
    await seedOneTime('at22', { startTime: '10:00' }); // 22h
    await seedOneTime('at24', { startTime: '12:00' }); // 24h
    await seedOneTime('at26', { startTime: '14:00' }); // 26h

    const stats = await runSendStudySessionReminders(getDb(), NOW);
    expect(stats.remindersSent).toBe(1);

    expect((await ssRef('at24').get()).data()!.reminderSent).toBe(true);
    expect((await ssRef('at22').get()).data()!.reminderSent).toBeUndefined();
    expect((await ssRef('at26').get()).data()!.reminderSent).toBeUndefined();
  });

  // ── Both sides notified ──

  it('notifies BOTH the tutor and the family', async () => {
    await seedOneTime('at24', { startTime: '12:00' });
    await runSendStudySessionReminders(getDb(), NOW);

    const tutorNotifs = await notifsFor(seed.tutor2.uid);
    const parentNotifs = await notifsFor(seed.parent1.uid);
    expect(tutorNotifs.some((n) => n.type === 'study_session_reminder')).toBe(true);
    expect(parentNotifs.some((n) => n.type === 'study_session_reminder')).toBe(true);
  });

  // ── Dedup via reminderSent ──

  it('is silent on a second run (reminderSent dedup)', async () => {
    await seedOneTime('at24', { startTime: '12:00' });
    const first = await runSendStudySessionReminders(getDb(), NOW);
    expect(first.remindersSent).toBe(1);
    const second = await runSendStudySessionReminders(getDb(), NOW);
    expect(second.remindersSent).toBe(0);
  });

  // ── Prefs gating (email off → no email, notif doc still written) ──

  it('writes the notification doc but no email when reminders.email is false', async () => {
    await getDb().collection('users').doc(seed.parent1.uid).update({
      'notifPrefs.shared.reminders': { push: true, email: false },
    });
    await seedOneTime('at24', { startTime: '12:00' });
    await runSendStudySessionReminders(getDb(), NOW);

    const parentNotifs = await notifsFor(seed.parent1.uid);
    const reminder = parentNotifs.find((n) => n.type === 'study_session_reminder');
    expect(reminder).toBeTruthy(); // doc still written per house pattern
    expect(reminder!.emailSent).toBe(false); // but no email dispatched
  });

  // ── Instance + one_time both covered ──

  it('reminds a recurring instance AND a one_time in the same run', async () => {
    await seedOneTime('one', { startTime: '12:00' });
    await seedRecurringWithInstance('rec', { startTime: '12:00' });

    const stats = await runSendStudySessionReminders(getDb(), NOW);
    expect(stats.remindersSent).toBe(2);

    expect((await ssRef('one').get()).data()!.reminderSent).toBe(true);
    // The dedup guard is set on the INSTANCE, not the recurring parent.
    expect((await instRef('rec', TOMORROW).get()).data()!.reminderSent).toBe(true);
    expect((await ssRef('rec').get()).data()!.reminderSent).toBeUndefined();
  });

  // ── Cancelled never reminded ──

  it('never reminds a cancelled one_time or a cancelled instance', async () => {
    await seedOneTime('cancelled-ot', { startTime: '12:00', status: 'cancelled' });
    await seedRecurringWithInstance('rec-cancelled', { startTime: '12:00', instanceStatus: 'cancelled' });

    const stats = await runSendStudySessionReminders(getDb(), NOW);
    expect(stats.remindersSent).toBe(0);
    expect((await ssRef('cancelled-ot').get()).data()!.reminderSent).toBeUndefined();
    expect((await instRef('rec-cancelled', TOMORROW).get()).data()!.reminderSent).toBeUndefined();
  });
});
