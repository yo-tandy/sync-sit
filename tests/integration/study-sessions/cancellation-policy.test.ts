import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// A fixed far-future Monday matching tutor2's weekly grid (Mon 16:00–20:00 →
// slots 64..79 true). Far enough out that the 24h booking notice never trips
// and the cancellation-policy window never trips at request time.
const FUTURE_MON = '2027-06-07';

type BookResponse = { sessionId: string };
type ProposeResponse = { sessionId: string };

const sessionData = (id: string) =>
  getDb().collection('study-sessions').doc(id).get().then((s) => s.data()!);

const instanceData = (id: string, date: string) =>
  getDb()
    .collection('study-sessions').doc(id).collection('instances').doc(date)
    .get().then((s) => s.data());

// A Paris wall-clock date + HH:MM roughly `hoursFromNow` from the real now. Used
// to place a confirmed commitment INSIDE or OUTSIDE a notice window relative to
// the callable's live `new Date()` (the flag is computed against real time).
function parisAt(hoursFromNow: number): { date: string; startTime: string } {
  const target = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(target)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, startTime: `${p.hour}:${p.minute}` };
}

describe('cancellation policy', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1 (Dupont)
  let tutor2Token: string; // the owning tutor

  // A valid one-time booking payload against tutor2 on the fixed future Monday.
  const bookInput = () => ({
    tutorUserId: seed.tutor2.uid,
    subject: 'math',
    level: '6e',
    date: FUTURE_MON,
    startTime: '16:00',
    sessionLengthMinutes: 60,
    location: 'online',
    studentIds: ['kid1', 'kid2'],
  });

  // A valid recurring booking payload (weekly Monday 16:00).
  const recurringInput = () => ({
    tutorUserId: seed.tutor2.uid,
    subject: 'math',
    level: '6e',
    sessionLengthMinutes: 60,
    location: 'online',
    studentIds: ['kid1', 'kid2'],
    type: 'recurring' as const,
    recurringSlot: { day: 'mon', startTime: '16:00' },
  });

  // A valid one-time proposal from tutor2 to family1 on the fixed future Monday.
  const proposeInput = () => ({
    familyId: seed.family1Id,
    subject: 'math',
    level: '6e',
    date: FUTURE_MON,
    startTime: '16:00',
    sessionLengthMinutes: 60,
    location: 'online',
  });

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  // Seed a study session doc directly (bypasses booking/availability so we can
  // place a CONFIRMED commitment inside a notice window on any date).
  interface SeedOverrides {
    sessionId?: string;
    type?: 'one_time' | 'recurring';
    status?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    cancellationNoticeHours?: number;
  }
  async function seedSession(over: SeedOverrides = {}): Promise<string> {
    const db = getDb();
    const id = over.sessionId ?? `sess-${Math.random().toString(36).slice(2, 9)}`;
    const doc: Record<string, unknown> = {
      sessionId: id,
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: over.type ?? 'one_time',
      startTime: over.startTime ?? '16:00',
      endTime: over.endTime ?? '17:00',
      sessionLengthMinutes: 60,
      location: 'online', paddingMinutes: 0,
      status: over.status ?? 'confirmed',
      createdAt: new Date(), updatedAt: new Date(),
    };
    if (over.type !== 'recurring') doc.date = over.date ?? parisAt(24).date;
    if (over.cancellationNoticeHours !== undefined) {
      doc.cancellationNoticeHours = over.cancellationNoticeHours;
    }
    await db.collection('study-sessions').doc(id).set(doc);
    return id;
  }

  async function seedInstance(
    sessionId: string,
    date: string,
    startTime: string,
    status = 'scheduled',
  ) {
    await getDb()
      .collection('study-sessions').doc(sessionId).collection('instances').doc(date)
      .set({
        instanceId: date, sessionId, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
        date, startTime, endTime: '11:00', sessionLengthMinutes: 60, paddingMinutes: 0,
        subject: 'math', level: '6e', rate: 25, location: 'online',
        status, createdAt: new Date(), updatedAt: new Date(),
      });
  }

  const notifBodiesFor = async (uid: string): Promise<string[]> => {
    const snap = await getDb().collection('notifications')
      .where('recipientUserId', '==', uid).get();
    return snap.docs
      .filter((d) => d.data().type === 'study_session_cancelled')
      .map((d) => d.data().body as string);
  };

  beforeEach(async () => {
    const db = getDb();
    // Approve family1 for tutor2 (book/propose/availability gate on it) and give
    // tutor2 a 48h cancellation policy by default; negatives override.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
      'profiles.tutor.cancellationNoticeHours': 48,
      'notifPrefs.study.newRequest': { push: true, email: true },
    });
    // Clear instances first (subcollections survive parent deletion).
    const inst = await db.collectionGroup('instances').get();
    await Promise.all(inst.docs.map((d) => d.ref.delete()));
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
  });

  // ── Task 3: policy snapshot at request creation ──

  describe('policy snapshot', () => {
    it('snapshots the tutor policy onto a one_time booking', async () => {
      const res = await callFunction<BookResponse>('bookSession', bookInput(), parent1Token);
      const doc = await sessionData(res.sessionId);
      expect(doc.cancellationNoticeHours).toBe(48);
    });

    it('snapshots the tutor policy onto a recurring parent doc', async () => {
      const res = await callFunction<BookResponse>('bookSession', recurringInput(), parent1Token);
      const doc = await sessionData(res.sessionId);
      expect(doc.type).toBe('recurring');
      expect(doc.cancellationNoticeHours).toBe(48);
    });

    it('snapshots the tutor policy onto a proposal doc', async () => {
      const res = await callFunction<ProposeResponse>('proposeSession', proposeInput(), tutor2Token);
      const doc = await sessionData(res.sessionId);
      expect(doc.proposedBy).toBe('provider');
      expect(doc.cancellationNoticeHours).toBe(48);
    });

    it('snapshots 0 when the tutor has no policy set', async () => {
      await getDb().collection('users').doc(seed.tutor2.uid).update({
        'profiles.tutor.cancellationNoticeHours': FieldValue.delete(),
      });
      const res = await callFunction<BookResponse>('bookSession', bookInput(), parent1Token);
      const doc = await sessionData(res.sessionId);
      expect(doc.cancellationNoticeHours).toBe(0);
    });
  });

  // ── Task 4: late flagging in cancelSession ──

  describe('cancelSession flagging', () => {
    it('flags a late one_time cancelled by the FAMILY (both directions)', async () => {
      const { date, startTime } = parisAt(24); // inside a 48h window
      const id = await seedSession({ status: 'confirmed', date, startTime, cancellationNoticeHours: 48 });
      await callFunction('cancelSession', { sessionId: id, reason: 'family emergency' }, parent1Token);

      const s = await sessionData(id);
      expect(s.lateCancellation).toBe(true);
      expect(s.statusReason).toBe('cancelled_by_family');
      // In-app notification to the tutor carries the late suffix.
      const bodies = await notifBodiesFor(seed.tutor2.uid);
      expect(bodies.some((b) => b.includes('(late cancellation)'))).toBe(true);
    });

    it('flags a late one_time cancelled by the TUTOR (both directions)', async () => {
      const { date, startTime } = parisAt(24);
      const id = await seedSession({ status: 'confirmed', date, startTime, cancellationNoticeHours: 48 });
      await callFunction('cancelSession', { sessionId: id, reason: 'tutor is ill' }, tutor2Token);

      const s = await sessionData(id);
      expect(s.lateCancellation).toBe(true);
      expect(s.statusReason).toBe('cancelled_by_tutor');
    });

    it('does NOT flag an on-time one_time cancel (assert absence)', async () => {
      const id = await seedSession({ status: 'confirmed', date: FUTURE_MON, startTime: '16:00', cancellationNoticeHours: 48 });
      await callFunction('cancelSession', { sessionId: id, reason: 'plenty of notice' }, parent1Token);

      const s = await sessionData(id);
      expect(s.lateCancellation).toBeUndefined();
      expect(s.status).toBe('cancelled');
    });

    it('does NOT flag when policy is 0, even seconds before start', async () => {
      const { date, startTime } = parisAt(1); // 1h out — but no policy
      const id = await seedSession({ status: 'confirmed', date, startTime, cancellationNoticeHours: 0 });
      await callFunction('cancelSession', { sessionId: id, reason: 'no policy set' }, parent1Token);

      const s = await sessionData(id);
      expect(s.lateCancellation).toBeUndefined();
    });

    it('does NOT flag a PENDING request even inside the window (pending is never late)', async () => {
      const { date, startTime } = parisAt(2);
      const id = await seedSession({ status: 'pending', date, startTime, cancellationNoticeHours: 48 });
      await callFunction('cancelSession', { sessionId: id, reason: 'withdrawing the request' }, parent1Token);

      const s = await sessionData(id);
      expect(s.lateCancellation).toBeUndefined();
      expect(s.status).toBe('cancelled');
    });

    it('flags only the in-window instance of a recurring series; parent never flagged', async () => {
      const near = parisAt(24); // inside 48h
      const far = parisAt(24 + 168); // +7d, outside 48h
      const id = await seedSession({
        sessionId: 'series-late', type: 'recurring', status: 'confirmed', cancellationNoticeHours: 48,
      });
      await seedInstance(id, near.date, near.startTime, 'scheduled');
      await seedInstance(id, far.date, far.startTime, 'scheduled');

      await callFunction('cancelSession', { sessionId: id, reason: 'moving away' }, tutor2Token);

      const nearInst = await instanceData(id, near.date);
      const farInst = await instanceData(id, far.date);
      expect(nearInst!.lateCancellation).toBe(true);
      expect(farInst!.lateCancellation).toBeUndefined();
      // The recurring PARENT is never flagged (commitment granularity is the instance).
      const parent = await sessionData(id);
      expect(parent.status).toBe('cancelled');
      expect(parent.lateCancellation).toBeUndefined();
    });

    it('retro-edit protection: the DOC snapshot governs, not the live profile', async () => {
      const { date, startTime } = parisAt(30); // 30h out — inside 168h, outside 24h
      const id = await seedSession({ status: 'confirmed', date, startTime, cancellationNoticeHours: 24 });
      // Tutor later widens their live policy to a week — must NOT retro-classify.
      await getDb().collection('users').doc(seed.tutor2.uid).update({
        'profiles.tutor.cancellationNoticeHours': 168,
      });
      await callFunction('cancelSession', { sessionId: id, reason: 'still on-time under snapshot' }, parent1Token);

      const s = await sessionData(id);
      // 30h > the snapshot's 24h → on-time. The live 168h is inert for this doc.
      expect(s.lateCancellation).toBeUndefined();
    });
  });

  // ── Task 5: late flagging in cancelSessionInstance ──

  describe('cancelSessionInstance flagging', () => {
    it('flags a single in-window instance; parent stays confirmed and unflagged', async () => {
      const near = parisAt(24); // inside 48h
      const id = await seedSession({
        sessionId: 'series-inst-late', type: 'recurring', status: 'confirmed', cancellationNoticeHours: 48,
      });
      await seedInstance(id, near.date, near.startTime, 'scheduled');

      await callFunction(
        'cancelSessionInstance',
        { sessionId: id, instanceId: near.date, reason: 'sick that day' },
        parent1Token,
      );

      const inst = await instanceData(id, near.date);
      expect(inst!.lateCancellation).toBe(true);
      expect(inst!.statusReason).toBe('cancelled_by_family');
      const parent = await sessionData(id);
      expect(parent.status).toBe('confirmed');
      expect(parent.lateCancellation).toBeUndefined();
    });

    it('does NOT flag an out-of-window instance (assert absence)', async () => {
      const far = parisAt(24 + 168); // +7d, outside 48h
      const id = await seedSession({
        sessionId: 'series-inst-ontime', type: 'recurring', status: 'confirmed', cancellationNoticeHours: 48,
      });
      await seedInstance(id, far.date, far.startTime, 'scheduled');

      await callFunction(
        'cancelSessionInstance',
        { sessionId: id, instanceId: far.date, reason: 'plenty of notice' },
        parent1Token,
      );

      const inst = await instanceData(id, far.date);
      expect(inst!.status).toBe('cancelled');
      expect(inst!.lateCancellation).toBeUndefined();
    });
  });

  // ── Task 6: searchTutors projects the policy ──

  describe('search projection', () => {
    // tutor2's own area (Paris center) — the search origin so tutor2 matches.
    const PARIS_CENTER = { lat: 48.8566, lng: 2.3522 };
    type TutorResult = { uid: string; cancellationNoticeHours: number };

    it('projects the tutor policy into search results', async () => {
      const res = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: PARIS_CENTER },
        parent1Token,
      );
      const tutor = res.results.find((r) => r.uid === seed.tutor2.uid);
      expect(tutor?.cancellationNoticeHours).toBe(48);
    });

    it('projects 0 when the tutor has no policy set', async () => {
      await getDb().collection('users').doc(seed.tutor2.uid).update({
        'profiles.tutor.cancellationNoticeHours': FieldValue.delete(),
      });
      const res = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: PARIS_CENTER },
        parent1Token,
      );
      const tutor = res.results.find((r) => r.uid === seed.tutor2.uid);
      expect(tutor?.cancellationNoticeHours).toBe(0);
    });
  });
});
