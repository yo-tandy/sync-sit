import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { clearAll, getDb } from '../../setup/emulator.js';

const require = createRequire(import.meta.url);
// Compiled dist, like the sibling sweep suites: both halves ride the
// cleanupOldData schedule, so the testable units are the extracted runners.
const { runCleanupOldData } = require(
  '../../../apps/functions/dist/scheduled/cleanupOldData.js'
) as typeof import('../../../apps/functions/src/scheduled/cleanupOldData.js');
const { runStudySweepSessions } = require(
  '../../../apps/functions/dist/scheduled/sweepStudySessions.js'
) as typeof import('../../../apps/functions/src/scheduled/sweepStudySessions.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}
/** The 'YYYY-MM-DD' booking date `n` days back — the sit retention clock. */
function dateAgo(n: number): string {
  return daysAgo(n).toISOString().split('T')[0];
}

const BSITTER = 'retention-bsitter';
const TUTOR = 'retention-tutor';

/** An all-available weekly grid, so a released claim restores to exactly it. */
async function seedSchedule(uid: string): Promise<void> {
  const weekly: Record<string, boolean[]> = {};
  for (const key of DAY_KEYS) weekly[key] = new Array(96).fill(true);
  await getDb().collection('schedules').doc(uid).set({ uid, weekly });
}

/**
 * An override doc in exactly the shape a confirm leaves behind: slots 32..40
 * AND-ed to false, with the matching `sessionBlocks` ledger entry.
 */
async function seedOverrideClaim(
  uid: string,
  date: string,
  entry: Record<string, unknown>,
  provenance: { appSource: string; reason: string },
): Promise<void> {
  const slots = new Array(96).fill(true);
  for (let i = 32; i < 40; i++) slots[i] = false;
  await getDb()
    .collection('schedules').doc(uid)
    .collection('overrides').doc(date)
    .set({
      date, type: 'custom', slots,
      sessionBlocks: [{ startIdx: 32, endIdx: 40, ...entry }],
      ...provenance,
      createdAt: daysAgo(300), updatedAt: daysAgo(300),
    });
}

async function overrideExists(uid: string, date: string): Promise<boolean> {
  return (
    await getDb().collection('schedules').doc(uid).collection('overrides').doc(date).get()
  ).exists;
}

/** Firestore rejects explicit `undefined`; an omitted field is the point here. */
function stripUndefined(doc: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
}

async function seedAppointment(id: string, overrides: Record<string, unknown>) {
  await getDb().collection('appointments').doc(id).set(stripUndefined({
    appointmentId: id, searchId: null, familyId: 'retention-family',
    babysitterUserId: BSITTER, createdByUserId: 'retention-parent',
    type: 'one_time', status: 'confirmed',
    kidIds: [], address: '1 rue Test', latLng: { lat: 48.85, lng: 2.35 },
    startTime: '18:00', endTime: '22:00',
    createdAt: daysAgo(300), updatedAt: daysAgo(300), confirmedAt: daysAgo(299),
    ...overrides,
  }));
}

async function seedSession(id: string, overrides: Record<string, unknown>) {
  await getDb().collection('study-sessions').doc(id).set(stripUndefined({
    sessionId: id, familyId: 'retention-family', tutorUserId: TUTOR,
    createdByUserId: 'retention-parent', subject: 'maths', level: '3e', rate: 30,
    studentIds: [], students: [], familyName: 'F', parentName: 'P', tutorName: 'T',
    type: 'one_time', startTime: '17:00', endTime: '18:00',
    sessionLengthMinutes: 60, paddingMinutes: 15, location: 'family_home',
    status: 'completed', completedAt: daysAgo(181),
    createdAt: daysAgo(300), updatedAt: daysAgo(181),
    ...overrides,
  }));
}

async function seedInstance(
  sessionId: string, date: string, overrides: Record<string, unknown> = {},
) {
  await getDb()
    .collection('study-sessions').doc(sessionId)
    .collection('instances').doc(date)
    .set({
      instanceId: date, sessionId, familyId: 'retention-family', tutorUserId: TUTOR,
      date, startTime: '17:00', endTime: '18:00', sessionLengthMinutes: 60,
      paddingMinutes: 15, status: 'completed', completedAt: daysAgo(200),
      subject: 'maths', level: '3e', rate: 30, location: 'family_home',
      createdAt: daysAgo(300), updatedAt: daysAgo(200),
      ...overrides,
    });
}

/**
 * A Firestore handle whose `schedules/{poisonUid}` lookup throws — the
 * deterministic per-document failure both cascades must survive. The claim
 * release is the first thing a cascade does, so a poisoned provider fails that
 * ONE engagement and nothing else.
 */
function poisonSchedules(db: Firestore, poisonUid: string): Firestore {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'collection') {
        return (name: string) => {
          const col = target.collection(name);
          if (name !== 'schedules') return col;
          return new Proxy(col, {
            get(c, p) {
              if (p === 'doc') {
                return (id: string) => {
                  if (id === poisonUid) throw new Error('poisoned schedule read');
                  return c.doc(id);
                };
              }
              const v = Reflect.get(c, p);
              return typeof v === 'function' ? v.bind(c) : v;
            },
          });
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Firestore;
}

async function wipe(): Promise<void> {
  const db = getDb();
  for (const col of ['appointments', 'cronState']) {
    const docs = await db.collection(col).get();
    await Promise.all(docs.docs.map((d) => d.ref.delete()));
  }
  const sessions = await db.collection('study-sessions').get();
  for (const s of sessions.docs) {
    const insts = await s.ref.collection('instances').get();
    await Promise.all(insts.docs.map((d) => d.ref.delete()));
    await s.ref.delete();
  }
  for (const uid of [BSITTER, TUTOR, 'poison-provider']) {
    const overrides = await db
      .collection('schedules').doc(uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
    await db.collection('schedules').doc(uid).delete();
  }
}

describe('completed-engagement retention (decision 19 / issue #294)', () => {
  beforeAll(async () => {
    await clearAll();
  });
  afterAll(async () => {
    await wipe();
  });
  beforeEach(async () => {
    await wipe();
    await seedSchedule(BSITTER);
    await seedSchedule(TUTOR);
  });

  // ────────────────────────── sync-sit ──────────────────────────
  describe('sit: confirmed appointments past their date', () => {
    it('deletes a 181-day-old confirmed appointment WITH its notes and its schedule claim', async () => {
      const date = dateAgo(181);
      await seedAppointment('sit-old', {
        date,
        preAppointmentNote: 'door code 1234B',
        postAppointmentNote: 'went well',
      });
      await seedOverrideClaim(BSITTER, date, { appointmentId: 'sit-old' },
        { appSource: 'sit', reason: 'appointment' });

      const stats = await runCleanupOldData(getDb(), new Date());

      expect(stats.completedAppointmentsDeleted).toBe(1);
      expect(stats.appointmentClaimsReleased).toBe(1);
      expect(stats.appointmentCascadeErrors).toBe(0);
      // The doc — and therefore both notes — is gone.
      expect((await getDb().collection('appointments').doc('sit-old').get()).exists)
        .toBe(false);
      // The ledger entry named a doc that no longer exists; the override held
      // nothing else, so the day reverts to the bare weekly grid.
      expect(await overrideExists(BSITTER, date)).toBe(false);
    });

    it('keeps a 179-day-old confirmed appointment — the boundary, other side', async () => {
      const date = dateAgo(179);
      await seedAppointment('sit-young', { date });
      await seedOverrideClaim(BSITTER, date, { appointmentId: 'sit-young' },
        { appSource: 'sit', reason: 'appointment' });

      const stats = await runCleanupOldData(getDb(), new Date());

      expect(stats.completedAppointmentsDeleted).toBe(0);
      expect(stats.appointmentClaimsReleased).toBe(0);
      expect((await getDb().collection('appointments').doc('sit-young').get()).exists)
        .toBe(true);
      expect(await overrideExists(BSITTER, date)).toBe(true);
    });

    it('keeps a recently completed sitting', async () => {
      await seedAppointment('sit-recent', { date: dateAgo(10) });
      const stats = await runCleanupOldData(getDb(), new Date());
      expect(stats.completedAppointmentsDeleted).toBe(0);
      expect((await getDb().collection('appointments').doc('sit-recent').get()).exists)
        .toBe(true);
    });

    it('never deletes a live recurring arrangement — no `date`, or an EMPTY `date`', async () => {
      // Dateless: absent from the (status, date) index entirely.
      await seedAppointment('sit-recurring', {
        type: 'recurring', date: undefined,
        recurringSlots: [{ day: 'mon', startTime: '18:00', endTime: '22:00' }],
      });
      // Empty string: IS in the index and sorts before every cutoff — only the
      // shape guard keeps it.
      await seedAppointment('sit-empty-date', { type: 'recurring', date: '' });

      const stats = await runCleanupOldData(getDb(), new Date());

      expect(stats.completedAppointmentsDeleted).toBe(0);
      const db = getDb();
      expect((await db.collection('appointments').doc('sit-recurring').get()).exists)
        .toBe(true);
      expect((await db.collection('appointments').doc('sit-empty-date').get()).exists)
        .toBe(true);
    });

    it('leaves an ancient PENDING appointment alone (7b keeps pending reachable forever)', async () => {
      await seedAppointment('sit-pending', { status: 'pending', date: dateAgo(400) });
      const stats = await runCleanupOldData(getDb(), new Date());
      expect(stats.completedAppointmentsDeleted).toBe(0);
      expect((await getDb().collection('appointments').doc('sit-pending').get()).exists)
        .toBe(true);
    });

    it('leaves cancelled/rejected retention exactly as it was (30 days, its own counter)', async () => {
      await seedAppointment('sit-cancelled-old', {
        status: 'cancelled', date: dateAgo(40), createdAt: daysAgo(31),
      });
      await seedAppointment('sit-cancelled-young', {
        status: 'cancelled', date: dateAgo(40), createdAt: daysAgo(29),
      });
      await seedAppointment('sit-rejected-old', {
        status: 'rejected', date: dateAgo(200), createdAt: daysAgo(31),
      });

      const stats = await runCleanupOldData(getDb(), new Date());

      // The old block, not the new one: a 200-day-old REJECTED doc is deleted
      // by the 30-day rule and must not be double-counted as retention.
      expect(stats.appointmentsDeleted).toBe(2);
      expect(stats.completedAppointmentsDeleted).toBe(0);
      const db = getDb();
      expect((await db.collection('appointments').doc('sit-cancelled-young').get()).exists)
        .toBe(true);
      expect((await db.collection('appointments').doc('sit-cancelled-old').get()).exists)
        .toBe(false);
      expect((await db.collection('appointments').doc('sit-rejected-old').get()).exists)
        .toBe(false);
    });

    it('isolates a per-document failure: the poisoned doc is skipped, its sibling still deleted', async () => {
      await seedAppointment('sit-poison', {
        date: dateAgo(190), babysitterUserId: 'poison-provider',
      });
      await seedAppointment('sit-healthy', { date: dateAgo(190) });

      const stats = await runCleanupOldData(
        poisonSchedules(getDb(), 'poison-provider'), new Date(),
      );

      expect(stats.appointmentCascadeErrors).toBe(1);
      expect(stats.completedAppointmentsDeleted).toBe(1);
      const db = getDb();
      expect((await db.collection('appointments').doc('sit-poison').get()).exists)
        .toBe(true);
      expect((await db.collection('appointments').doc('sit-healthy').get()).exists)
        .toBe(false);
    });
  });

  // ───────────────────────── sync-study ─────────────────────────
  describe('study: completed sessions and series', () => {
    it('deletes a 181-day-old completed one_time session WITH its notes and schedule claim', async () => {
      const date = dateAgo(182);
      await seedSession('study-old', {
        date,
        preSessionNote: 'bring the geometry set',
        postSessionNote: 'covered Pythagoras',
      });
      await seedOverrideClaim(TUTOR, date, { sessionId: 'study-old' },
        { appSource: 'study', reason: 'study_session' });

      const stats = await runStudySweepSessions(getDb(), new Date());

      expect(stats.completedSessionsDeleted).toBe(1);
      expect(stats.overrideClaimsReleased).toBe(1);
      expect(stats.sessionCascadeErrors).toBe(0);
      expect((await getDb().collection('study-sessions').doc('study-old').get()).exists)
        .toBe(false);
      expect(await overrideExists(TUTOR, date)).toBe(false);
    });

    it('deletes a completed SERIES together with every instance and its per-occurrence notes', async () => {
      await seedSession('study-series', {
        type: 'recurring', date: undefined, endTime: undefined,
        endDate: dateAgo(190), completedAt: daysAgo(181),
        recurringSlots: [{ day: 'mon', startTime: '17:00', endTime: '18:00' }],
      });
      await seedInstance('study-series', dateAgo(210), {
        postSessionNote: 'struggled with fractions',
      });
      await seedInstance('study-series', dateAgo(203));
      await seedInstance('study-series', dateAgo(196), {
        status: 'cancelled', statusReason: 'conflict_skip',
      });
      // Belt-and-braces: an occurrence whose claim was somehow never pruned.
      const stale = dateAgo(203);
      await seedOverrideClaim(TUTOR, stale,
        { sessionId: 'study-series', instanceId: stale },
        { appSource: 'study', reason: 'study_session' });

      const stats = await runStudySweepSessions(getDb(), new Date());

      expect(stats.completedSessionsDeleted).toBe(1);
      expect(stats.instancesDeleted).toBe(3);
      expect(stats.overrideClaimsReleased).toBe(1);
      const parent = getDb().collection('study-sessions').doc('study-series');
      expect((await parent.get()).exists).toBe(false);
      // Firestore keeps subcollections when a parent is deleted — the cascade
      // is what makes them go, and the CG queries stop returning them.
      expect((await parent.collection('instances').get()).size).toBe(0);
      expect(await overrideExists(TUTOR, stale)).toBe(false);
    });

    it('keeps a 179-day-old completed session — the boundary, other side', async () => {
      await seedSession('study-young', { date: dateAgo(179), completedAt: daysAgo(179) });
      await seedInstance('study-young', dateAgo(179));

      const stats = await runStudySweepSessions(getDb(), new Date());

      expect(stats.completedSessionsDeleted).toBe(0);
      expect(stats.instancesDeleted).toBe(0);
      const ref = getDb().collection('study-sessions').doc('study-young');
      expect((await ref.get()).exists).toBe(true);
      expect((await ref.collection('instances').get()).size).toBe(1);
    });

    it('keeps a recently completed session', async () => {
      await seedSession('study-recent', { date: dateAgo(3), completedAt: daysAgo(3) });
      const stats = await runStudySweepSessions(getDb(), new Date());
      expect(stats.completedSessionsDeleted).toBe(0);
      expect((await getDb().collection('study-sessions').doc('study-recent').get()).exists)
        .toBe(true);
    });

    it('touches no non-completed session, however old', async () => {
      await seedSession('study-cancelled', {
        status: 'cancelled', completedAt: undefined, cancelledAt: daysAgo(300),
        date: dateAgo(300),
      });
      await seedSession('study-confirmed', {
        status: 'confirmed', completedAt: undefined, date: dateAgo(300),
      });

      const stats = await runStudySweepSessions(getDb(), new Date());

      expect(stats.completedSessionsDeleted).toBe(0);
      const db = getDb();
      expect((await db.collection('study-sessions').doc('study-cancelled').get()).exists)
        .toBe(true);
      expect((await db.collection('study-sessions').doc('study-confirmed').get()).exists)
        .toBe(true);
    });

    it('isolates a per-document failure: the poisoned session keeps its instances', async () => {
      await seedSession('study-poison', {
        date: dateAgo(190), completedAt: daysAgo(190), tutorUserId: 'poison-provider',
      });
      await seedInstance('study-poison', dateAgo(190), { tutorUserId: 'poison-provider' });
      await seedSession('study-healthy', { date: dateAgo(190), completedAt: daysAgo(190) });

      const stats = await runStudySweepSessions(
        poisonSchedules(getDb(), 'poison-provider'), new Date(),
      );

      expect(stats.sessionCascadeErrors).toBe(1);
      expect(stats.completedSessionsDeleted).toBe(1);
      const db = getDb();
      const poisoned = db.collection('study-sessions').doc('study-poison');
      expect((await poisoned.get()).exists).toBe(true);
      // Documents are deleted LAST, so a failed cascade leaves nothing partly
      // applied — the whole thing retries next run.
      expect((await poisoned.collection('instances').get()).size).toBe(1);
      expect((await db.collection('study-sessions').doc('study-healthy').get()).exists)
        .toBe(false);
    });
  });
});
