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

  beforeEach(async () => {
    const db = getDb();
    // Approve family1 for tutor2 (book/propose/availability gate on it) and give
    // tutor2 a 48h cancellation policy by default; negatives override.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
      'profiles.tutor.cancellationNoticeHours': 48,
      'notifPrefs.newRequest': { push: true, email: true },
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
});
