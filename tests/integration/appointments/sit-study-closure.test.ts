import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

/**
 * Cross-app closure — the point of the sit override-ledger PR.
 *
 * A single uid that is BOTH a babysitter (sit) and a tutor (study) can carry a
 * sit appointment claim AND a study session claim in the SAME override doc on
 * the same date. Because each app's claim is a ledger entry keyed by its own
 * range, cancelling one app's claim must restore ONLY that app's slots and
 * leave the other app's block intact — in BOTH directions.
 *
 * A far-future Monday. The shared weekly grid is open 16:00–20:00 (slots 64..79).
 *   • study block: 16:00–17:00 → slots 64..67  (entry [64,68))
 *   • sit block:   18:00–19:00 → slots 72..75  (entry [72,76))
 * 68..71 and 76..79 stay open throughout.
 */
describe('sit ↔ study cross-app closure', () => {
  let seed: SeedData;
  let dualToken: string;
  const DUAL_UID = 'dual-role-tutor-sitter';
  const MON = '2027-06-07';

  const overrideRef = () =>
    getDb().collection('schedules').doc(DUAL_UID).collection('overrides').doc(MON);

  /** Slots 64..79 open except the study (64..67) and sit (72..75) blocks. */
  function bothClaimedSlots(): boolean[] {
    const slots = new Array(96).fill(false);
    for (let i = 64; i < 80; i++) slots[i] = true; // weekly-open window
    for (let i = 64; i < 68; i++) slots[i] = false; // study claim
    for (let i = 72; i < 76; i++) slots[i] = false; // sit claim
    return slots;
  }

  function weeklyMon(): boolean[] {
    const g = new Array(96).fill(false);
    for (let i = 64; i < 80; i++) g[i] = true;
    return g;
  }

  const STUDY_ENTRY = { sessionId: 'closure-sess', startIdx: 64, endIdx: 68 };
  const SIT_APPT_ID = 'closure-appt';
  const SIT_ENTRY = { appointmentId: SIT_APPT_ID, startIdx: 72, endIdx: 76 };

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();

    // A dual-role user: babysitter + tutor profiles, one weekly grid.
    await getDb().collection('users').doc(DUAL_UID).set({
      uid: DUAL_UID, email: 'dual@ejm.org', status: 'active',
      firstName: 'Dana', lastName: 'Dual',
      profiles: {
        babysitter: { enrollmentComplete: true, searchable: true },
        tutor: { enrollmentComplete: true, searchable: true },
      },
    });
    await getDb().collection('schedules').doc(DUAL_UID).set({ weekly: { mon: weeklyMon() } });

    dualToken = await getIdToken(DUAL_UID);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    await overrideRef().delete().catch(() => {});
    await getDb().collection('study-sessions').doc(STUDY_ENTRY.sessionId).delete().catch(() => {});
    await getDb().collection('appointments').doc(SIT_APPT_ID).delete().catch(() => {});
  });

  /** Seed a confirmed one_time study session owned by the dual tutor. */
  async function seedConfirmedSession() {
    await getDb().collection('study-sessions').doc(STUDY_ENTRY.sessionId).set({
      sessionId: STUDY_ENTRY.sessionId,
      tutorUserId: DUAL_UID,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Dana Dual',
      type: 'one_time', date: MON, startTime: '16:00', endTime: '17:00',
      sessionLengthMinutes: 60, location: 'online', paddingMinutes: 0,
      status: 'confirmed', confirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
  }

  /** Seed a confirmed sit appointment owned by the dual babysitter. */
  async function seedConfirmedAppt() {
    await seedAppointment({
      appointmentId: SIT_APPT_ID,
      babysitterUserId: DUAL_UID,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
      date: MON, startTime: '18:00', endTime: '19:00',
    });
  }

  it('cancel the STUDY session → the SIT block survives (study-owned doc)', async () => {
    await seedConfirmedSession();
    await seedConfirmedAppt();
    // Study created the doc first; sit merged in → STUDY provenance, both entries.
    await overrideRef().set({
      date: MON, type: 'custom', slots: bothClaimedSlots(),
      appSource: 'study', reason: 'study_session',
      sessionBlocks: [STUDY_ENTRY, SIT_ENTRY],
      createdAt: new Date(), updatedAt: new Date(),
    });

    await callFunction(
      'cancelSession',
      { sessionId: STUDY_ENTRY.sessionId, reason: 'Tutor unavailable' },
      dualToken
    );

    const doc = (await overrideRef().get()).data()!;
    const slots = doc.slots as boolean[];
    // Study's range reopened...
    expect(slots[64]).toBe(true);
    expect(slots[67]).toBe(true);
    // ...but the SIT block SURVIVES (its ledger entry still covers 72..75).
    expect(slots[72]).toBe(false);
    expect(slots[75]).toBe(false);
    expect(doc.sessionBlocks).toEqual([SIT_ENTRY]);
  });

  it('cancel the SIT appointment → the STUDY block survives (sit-owned doc)', async () => {
    await seedConfirmedSession();
    await seedConfirmedAppt();
    // Sit created the doc first; study merged in → SIT provenance, both entries.
    await overrideRef().set({
      date: MON, type: 'custom', slots: bothClaimedSlots(),
      appSource: 'sit', reason: 'appointment',
      sessionBlocks: [SIT_ENTRY, STUDY_ENTRY],
      createdAt: new Date(), updatedAt: new Date(),
    });

    await callFunction(
      'cancelAppointment',
      { appointmentId: SIT_APPT_ID, reason: 'Sitter unavailable' },
      dualToken
    );

    const doc = (await overrideRef().get()).data()!;
    const slots = doc.slots as boolean[];
    // Sit's range reopened...
    expect(slots[72]).toBe(true);
    expect(slots[75]).toBe(true);
    // ...but the STUDY block SURVIVES (its ledger entry still covers 64..67).
    expect(slots[64]).toBe(false);
    expect(slots[67]).toBe(false);
    expect(doc.sessionBlocks).toEqual([STUDY_ENTRY]);
  });
});
