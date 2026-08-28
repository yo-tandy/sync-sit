import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Identity-correction name fan-out (issue #273): both correction callables
// (admin correctUserIdentity, guardian correctChildIdentity) refresh the
// denormalized display-name copies after a first/last-name change.
// Attribution per doc:
//   - tutorName: tutorUserId (every session / contact-request doc).
//   - parentName: parentUserId (new at the fill sites), plus the legacy
//     createdByUserId sweep for pre-#273 parent-CREATED docs; a doc whose
//     parentName landed at a respond/confirm step without parentUserId is
//     unreachable BY DESIGN and must stay untouched.
//   - submittedByName: study endorsements only (appSource 'study') — sit
//     family endorsements store the free-text refName there, never the
//     submitter's account name.
// See docs/superpowers/plans/2026-08-28-identity-fanout.md.

describe('identity-correction name fan-out', () => {
  let seed: SeedData;
  let adminToken: string;
  let parent1Token: string;
  const db = () => getDb();

  // Corrected targets: a parent and a tutor whose names are denormalized
  // into the seeded docs below.
  const P = 'fanParent1';
  const T = 'fanTutor1';

  async function seedUser(uid: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) {
    await db().collection('users').doc(uid).set({
      uid,
      email: `${uid}@ejm.org`,
      status: 'active',
      firstName,
      lastName,
      dateOfBirth: new Date('1990-05-01'),
      language: 'en',
      profiles: {},
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
  }

  /** Minimal study-sessions doc: only the attribution + name fields matter to the sweeps. */
  async function seedSession(id: string, fields: Record<string, unknown>) {
    await db().collection('study-sessions').doc(id).set({
      sessionId: id,
      familyId: seed.family1Id,
      subject: 'math',
      level: '6e',
      rate: 25,
      type: 'one_time',
      date: '2027-03-01',
      startTime: '16:00',
      status: 'confirmed',
      familyName: 'Dupont',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...fields,
    });
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parent1Token = await getIdToken(seed.parent1.uid);

    await seedUser(P, 'Old', 'Parent');
    await seedUser(T, 'Old', 'Tutor');

    // study-sessions — new shape (parentUserId), legacy parent-created
    // (createdByUserId only), and a legacy confirmed provider proposal whose
    // parentName owner was never recorded (createdByUserId === tutorUserId).
    await seedSession('fanS_new', {
      tutorUserId: T, createdByUserId: P, parentUserId: P,
      parentName: 'Old Parent', tutorName: 'Old Tutor',
    });
    await seedSession('fanS_legacy', {
      tutorUserId: T, createdByUserId: P,
      parentName: 'Old Parent', tutorName: 'Old Tutor',
    });
    await seedSession('fanS_providerLegacy', {
      tutorUserId: T, createdByUserId: T, proposedBy: 'provider',
      parentName: 'Old Parent', tutorName: 'Old Tutor',
    });

    // studyContactRequests — parent-initiated new shape, and a legacy
    // tutor-initiated doc whose parentName was filled at accept without a uid.
    await db().collection('studyContactRequests').doc('fanR_new').set({
      requestId: 'fanR_new', tutorUserId: T, familyId: seed.family1Id,
      familyName: 'Dupont', parentName: 'Old Parent', parentUserId: P,
      tutorName: 'Old Tutor', createdByUserId: P, subject: 'math', level: '6e',
      status: 'accepted', createdAt: new Date(), updatedAt: new Date(),
    });
    await db().collection('studyContactRequests').doc('fanR_acceptLegacy').set({
      requestId: 'fanR_acceptLegacy', tutorUserId: T, familyId: seed.family1Id,
      familyName: 'Dupont', parentName: 'Old Parent', tutorName: 'Old Tutor',
      createdByUserId: T, initiatedBy: 'tutor', subject: 'math', level: '6e',
      status: 'accepted', createdAt: new Date(), updatedAt: new Date(),
    });

    // contactSharingRequests (sit; note the uppercased last name) — new shape
    // with parentUserId, and a legacy doc with only familyId.
    await db().collection('contactSharingRequests').doc('fanC_new').set({
      requestId: 'fanC_new', babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id, familyName: 'Dupont',
      parentName: 'Old PARENT', parentUserId: P,
      status: 'pending', createdAt: new Date(),
    });
    await db().collection('contactSharingRequests').doc('fanC_legacy').set({
      requestId: 'fanC_legacy', babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id, familyName: 'Dupont',
      parentName: 'Old PARENT',
      status: 'pending', createdAt: new Date(),
    });

    // references — a study endorsement (submittedByName IS the submitter's
    // account name) and a sit family endorsement (submittedByName is the
    // free-text refName; must never be rewritten).
    await db().collection('references').doc('fanE_study').set({
      referenceId: 'fanE_study', type: 'family_submitted', appSource: 'study',
      status: 'private', tutorUserId: T, submittedByUserId: P,
      submittedByFamilyId: seed.family1Id, submittedByName: 'Old Parent',
      refName: 'Lucas', referenceText: 'Great tutor', isEjmFamily: true,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db().collection('references').doc('fanE_sit').set({
      referenceId: 'fanE_sit', type: 'family_submitted', status: 'private',
      babysitterUserId: seed.babysitter1.uid, submittedByUserId: P,
      submittedByFamilyId: seed.family1Id, submittedByName: 'Aunt Josette',
      refName: 'Aunt Josette', referenceText: 'Lovely sitter', isEjmFamily: true,
      createdAt: new Date(), updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  const getDoc = async (collection: string, id: string) =>
    (await db().collection(collection).doc(id).get()).data()!;

  it('fans a parent-name correction out into every attributable copy — and ONLY those', async () => {
    const result = await callFunction(
      'correctUserIdentity',
      { targetUserId: P, firstName: 'New', lastName: 'Parent' },
      adminToken,
    );
    expect(result).toEqual({ success: true });

    // Attributable copies follow the correction.
    expect((await getDoc('study-sessions', 'fanS_new')).parentName).toBe('New Parent');
    expect((await getDoc('study-sessions', 'fanS_legacy')).parentName).toBe('New Parent');
    expect((await getDoc('studyContactRequests', 'fanR_new')).parentName).toBe('New Parent');
    // Sit format keeps its uppercased last name.
    expect((await getDoc('contactSharingRequests', 'fanC_new')).parentName).toBe('New PARENT');
    expect((await getDoc('references', 'fanE_study')).submittedByName).toBe('New Parent');

    // Unattributable / foreign copies stay untouched.
    expect((await getDoc('study-sessions', 'fanS_providerLegacy')).parentName).toBe('Old Parent');
    expect((await getDoc('studyContactRequests', 'fanR_acceptLegacy')).parentName).toBe('Old Parent');
    expect((await getDoc('contactSharingRequests', 'fanC_legacy')).parentName).toBe('Old PARENT');
    expect((await getDoc('references', 'fanE_sit')).submittedByName).toBe('Aunt Josette');
    // The tutor's copies belong to the tutor, not the corrected parent.
    expect((await getDoc('study-sessions', 'fanS_new')).tutorName).toBe('Old Tutor');
    expect((await getDoc('studyContactRequests', 'fanR_new')).tutorName).toBe('Old Tutor');

    // The audit entry records what was fanned out.
    const audits = await db()
      .collection('auditLogs')
      .where('action', '==', 'user_identity_corrected')
      .get();
    const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === P);
    expect(mine.length).toBe(1);
    expect(mine[0].details.fanOut).toEqual({
      updated: {
        'study-sessions': { tutorName: 0, parentName: 2 },
        studyContactRequests: { tutorName: 0, parentName: 1 },
        contactSharingRequests: { parentName: 1 },
        references: { submittedByName: 1 },
      },
      errors: [],
    });
  });

  it('fans a tutor-name correction out via tutorUserId (reaches docs with NO parentUserId)', async () => {
    // Partial correction: only the last name changes; the fan-out composes
    // it with the stored first name.
    await callFunction(
      'correctUserIdentity',
      { targetUserId: T, lastName: 'Cohen' },
      adminToken,
    );

    for (const id of ['fanS_new', 'fanS_legacy', 'fanS_providerLegacy']) {
      expect((await getDoc('study-sessions', id)).tutorName).toBe('Old Cohen');
    }
    expect((await getDoc('studyContactRequests', 'fanR_new')).tutorName).toBe('Old Cohen');
    expect((await getDoc('studyContactRequests', 'fanR_acceptLegacy')).tutorName).toBe('Old Cohen');
    // The parent copies (already corrected above) are not the tutor's to touch.
    expect((await getDoc('study-sessions', 'fanS_new')).parentName).toBe('New Parent');
    expect((await getDoc('study-sessions', 'fanS_providerLegacy')).parentName).toBe('Old Parent');

    const audits = await db()
      .collection('auditLogs')
      .where('action', '==', 'user_identity_corrected')
      .get();
    const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === T);
    expect(mine.length).toBe(1);
    expect(mine[0].details.fanOut.updated['study-sessions']).toEqual({
      tutorName: 3,
      parentName: 0,
    });
    expect(mine[0].details.fanOut.updated.studyContactRequests).toEqual({
      tutorName: 2,
      parentName: 0,
    });
  });

  it('a DOB-only correction fans out nothing (names are the only denormalized identity)', async () => {
    await callFunction(
      'correctUserIdentity',
      { targetUserId: P, dateOfBirth: '1990-05-02' },
      adminToken,
    );

    const audits = await db()
      .collection('auditLogs')
      .where('action', '==', 'user_identity_corrected')
      .get();
    const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === P);
    expect(mine.length).toBe(2); // the name correction above + this one
    const dobOnly = mine.find((a) => a.details.after.dateOfBirth === '1990-05-02')!;
    expect(dobOnly.details.fanOut).toBeUndefined();
  });

  it('correctChildIdentity fans out a governed tutor-kid name the same way', async () => {
    const KID = 'fanKidTutor1';
    await seedUser(KID, 'Old', 'Kid', {
      identityLocked: true,
      governedBy: { familyId: seed.parent1.familyId, linkedAt: new Date() },
      dateOfBirth: new Date('2010-04-01'),
    });
    await db().collection('guardianLinks').doc(KID).set({
      childUid: KID,
      familyId: seed.parent1.familyId,
      createdByParentUid: seed.parent1.uid,
      status: 'active',
      origin: 'invite',
      requestedAt: new Date(),
      confirmedAt: new Date(),
    });
    await seedSession('fanS_kid', {
      tutorUserId: KID, createdByUserId: 'someParent',
      parentName: 'Some Parent', tutorName: 'Old Kid',
    });

    const result = await callFunction(
      'correctChildIdentity',
      { childUid: KID, firstName: 'New' },
      parent1Token,
    );
    expect(result).toMatchObject({ success: true });

    expect((await getDoc('study-sessions', 'fanS_kid')).tutorName).toBe('New Kid');
    // The kid is not the parentName owner.
    expect((await getDoc('study-sessions', 'fanS_kid')).parentName).toBe('Some Parent');

    const audits = await db()
      .collection('auditLogs')
      .where('action', '==', 'guardian.correct_child_identity')
      .get();
    const mine = audits.docs.map((d) => d.data()).filter((a) => a.targetUserId === KID);
    expect(mine.length).toBe(1);
    expect(mine[0].details.fanOut.updated['study-sessions']).toEqual({
      tutorName: 1,
      parentName: 0,
    });
    expect(mine[0].details.fanOut.errors).toEqual([]);
  });
});
