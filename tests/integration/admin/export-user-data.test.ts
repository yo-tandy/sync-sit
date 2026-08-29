import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import {
  seedTestData,
  seedAppointment,
  seedStudySession,
  seedStudyInstance,
  type SeedData,
} from '../../setup/seed.js';

interface ExportResponse {
  user: { id: string; email: string; profiles?: { parent?: unknown; babysitter?: unknown } };
  family: { id: string; familyName: string } | null;
  appointments: Array<{ id: string }>;
  notifications: Array<{ id: string }>;
  auditLogs: Array<{ id: string; action: string }>;
  references: Array<{ id: string; referenceText?: string }>;
  studySessions: Array<{
    id: string;
    tutorName?: string;
    students?: Array<{ firstName: string; age: number }>;
    instances: Array<{ id: string; preSessionNote?: string }>;
  }>;
  schedule: { id: string; overrides: Array<{ id: string }> } | null;
}

describe('exportUserData', () => {
  let seed: SeedData;
  let adminToken: string;
  let parentToken: string;
  let sitRefId: string;
  let studyRefId: string;
  let unrelatedRefId: string;
  let tutorSessionId: string;
  let recurringSessionId: string;
  let unrelatedSessionId: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parentToken = await getIdToken(seed.parent1.uid);

    // Side data for parent1
    await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });
    const db = getDb();
    await db.collection('notifications').add({
      recipientUserId: seed.parent1.uid,
      type: 'confirmed',
      createdAt: new Date(),
    });
    await db.collection('auditLogs').add({
      adminUserId: seed.admin.uid,
      action: 'block_user',
      targetUserId: seed.parent1.uid,
      timestamp: new Date(),
    });

    // References / endorsements (issue #295): one sit reference submitted by
    // parent1 about babysitter1, one study endorsement submitted by parent2
    // (parent1's co-parent, same family) about tutor1, and one unrelated to
    // any of them (family2 about babysitter2).
    sitRefId = (await db.collection('references').add({
      type: 'family_submitted',
      status: 'approved',
      babysitterUserId: seed.babysitter1.uid,
      submittedByUserId: seed.parent1.uid,
      submittedByFamilyId: seed.family1Id,
      submittedByName: 'Claire Dupont',
      refName: 'Claire Dupont',
      refPhone: '+33600000001',
      appointmentId: 'appt-export-ref',
      referenceText: 'Wonderful with our kids, highly recommended.',
      createdAt: new Date(),
      updatedAt: new Date(),
    })).id;
    studyRefId = (await db.collection('references').add({
      type: 'family_submitted',
      appSource: 'study',
      status: 'private',
      tutorUserId: seed.tutor1.uid,
      submittedByUserId: seed.parent2.uid,
      submittedByFamilyId: seed.family1Id,
      submittedByName: 'Marc Dupont',
      refName: 'Marc Dupont',
      referenceText: 'Patient tutor, our daughter improved fast.',
      createdAt: new Date(),
      updatedAt: new Date(),
    })).id;
    unrelatedRefId = (await db.collection('references').add({
      type: 'family_submitted',
      status: 'approved',
      babysitterUserId: seed.babysitter2.uid,
      submittedByUserId: seed.parent3.uid,
      submittedByFamilyId: seed.family2Id,
      submittedByName: 'Anna Martin',
      refName: 'Anna Martin',
      referenceText: 'Great sitter, always on time.',
      createdAt: new Date(),
      updatedAt: new Date(),
    })).id;

    // Study sessions (issue #408 item 1): one one_time session between
    // family1 and tutor1 (so it is reachable from BOTH the tutor side and the
    // family side), one recurring series with an occurrence, and one belonging
    // to neither — the isolation control.
    tutorSessionId = await seedStudySession({
      familyId: seed.family1Id,
      tutorUserId: seed.tutor1.uid,
      createdByUserId: seed.parent1.uid,
      parentUserId: seed.parent1.uid,
      status: 'completed',
      date: '2026-05-04',
      postSessionNote: 'covered quadratics',
    });
    recurringSessionId = await seedStudySession({
      familyId: seed.family1Id,
      tutorUserId: seed.tutor1.uid,
      status: 'confirmed',
      type: 'recurring',
      date: undefined,
      endTime: undefined,
      recurringSlots: [{ day: 'wed', startTime: '17:00', endTime: '18:00' }],
    });
    await seedStudyInstance(recurringSessionId, '2026-09-02', {
      preSessionNote: 'ring the second bell',
    });
    unrelatedSessionId = await seedStudySession({
      familyId: seed.family2Id,
      tutorUserId: seed.tutor2.uid,
      status: 'confirmed',
      date: '2026-09-10',
    });

    // A tutor override, so the schedule export has an overrides row to carry.
    await db.collection('schedules').doc(seed.tutor1.uid)
      .collection('overrides').doc('2026-12-24')
      .set({ date: '2026-12-24', type: 'unavailable', slots: [] });
  });

  afterAll(async () => {
    await clearAll();
  });

  describe('happy paths', () => {
    it('exports a parent: user, family, appointments, notifications, audit logs', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      expect(result.user.id).toBe(seed.parent1.uid);
      expect(result.user.email).toBe(seed.parent1.email);
      expect(result.user.profiles?.parent).toBeTruthy();

      expect(result.family).not.toBeNull();
      expect(result.family!.id).toBe(seed.family1Id);
      expect(result.family!.familyName).toBe('Dupont');

      expect(result.appointments.length).toBeGreaterThanOrEqual(1);
      expect(result.notifications.length).toBeGreaterThanOrEqual(1);
      // Pre-seeded block_user audit log targeting parent1 should be returned
      const actions = result.auditLogs.map((a) => a.action);
      expect(actions).toContain('block_user');
    });

    it('exports a babysitter: family is null, babysitter appointments included', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.babysitter1.uid },
        adminToken,
      );

      expect(result.user.profiles?.babysitter).toBeTruthy();
      expect(result.family).toBeNull();
      expect(result.appointments.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates appointments where the user is both family-member and babysitter (or duplicated query)', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      const ids = result.appointments.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes references where the user is the PROVIDER (sit babysitter)', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.babysitter1.uid },
        adminToken,
      );

      const ids = result.references.map((r) => r.id);
      expect(ids).toContain(sitRefId);
      // Another sitter's reference and a study endorsement of someone else
      // must not leak into this export.
      expect(ids).not.toContain(unrelatedRefId);
      expect(ids).not.toContain(studyRefId);
    });

    it('includes endorsements where the user is the PROVIDER (study tutor)', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.tutor1.uid },
        adminToken,
      );

      const ids = result.references.map((r) => r.id);
      expect(ids).toContain(studyRefId);
      expect(ids).not.toContain(sitRefId);
      expect(ids).not.toContain(unrelatedRefId);
    });

    it('includes references where the user is the SUBMITTER, plus family-keyed endorsements, deduplicated', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      const ids = result.references.map((r) => r.id);
      // Submitted personally (submittedByUserId == parent1)
      expect(ids).toContain(sitRefId);
      // Submitted by the co-parent from the same family — family-level data
      // reachable via submittedByFamilyId, like family appointments.
      expect(ids).toContain(studyRefId);
      // Another family's reference stays out.
      expect(ids).not.toContain(unrelatedRefId);
      // sitRef matches both the submitter and the family key — exported once.
      expect(new Set(ids).size).toBe(ids.length);
    });

    /**
     * Issue #408 item 1 — the export half of the same gap: `study-sessions`
     * and `schedules/{uid}` were absent from every subject-access request,
     * even though `deleteUser` has always erased the schedule document.
     */
    it('includes the study sessions where the user is the TUTOR, with each series\' instances', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.tutor1.uid },
        adminToken,
      );

      const ids = result.studySessions.map((s) => s.id);
      expect(ids).toContain(tutorSessionId);
      expect(ids).toContain(recurringSessionId);
      expect(ids).not.toContain(unrelatedSessionId);

      // Firestore never returns a subcollection with its parent, so a flat
      // export would drop every occurrence — and every per-occurrence note.
      const series = result.studySessions.find((s) => s.id === recurringSessionId)!;
      expect(series.instances.map((i) => i.id)).toEqual(['2026-09-02']);
      expect(series.instances[0].preSessionNote).toBe('ring the second bell');
      // The one_time session carries no instances, not a missing key.
      expect(
        result.studySessions.find((s) => s.id === tutorSessionId)!.instances,
      ).toEqual([]);
    });

    it('includes the FAMILY side study sessions in a parent export, deduplicated', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      const ids = result.studySessions.map((s) => s.id);
      expect(ids).toContain(tutorSessionId);
      expect(ids).toContain(recurringSessionId);
      expect(ids).not.toContain(unrelatedSessionId);
      expect(new Set(ids).size).toBe(ids.length);
      // The denormalized roster is family personal data and must be in the
      // export the family receives.
      expect(
        result.studySessions.find((s) => s.id === tutorSessionId)!.students,
      ).toEqual([{ firstName: 'Lucas', age: 6 }]);
    });

    it('includes the availability schedule and its overrides', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.tutor1.uid },
        adminToken,
      );

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.id).toBe(seed.tutor1.uid);
      expect(result.schedule!.overrides.map((o) => o.id)).toContain('2026-12-24');
    });

    it('returns a null schedule and no study sessions for a user with neither', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.admin.uid },
        adminToken,
      );

      expect(result.schedule).toBeNull();
      expect(result.studySessions).toEqual([]);
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(
        callFunction('exportUserData', { targetUserId: seed.parent1.uid }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects non-admin (parent) callers', async () => {
      await expect(
        callFunction(
          'exportUserData',
          { targetUserId: seed.parent1.uid },
          parentToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('returns not-found for missing user', async () => {
      await expect(
        callFunction('exportUserData', { targetUserId: 'nope' }, adminToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
