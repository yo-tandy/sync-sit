import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

// getGovernedChildren / getGovernedChildDetail — guardian oversight reads.
// Ruling 8 pin: the detail payload contains EVERYTHING, including pre/post
// session notes, request messages, and lateCancellation flags.

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

/** A "YYYY-MM-DD" DOB for someone who turned `age` about five months ago. */
function dobWithAge(age: number): string {
  const d = new Date();
  let y = d.getFullYear();
  let m = d.getMonth() - 5;
  if (m < 0) {
    m += 12;
    y -= 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y - age}-${pad(m + 1)}-15`;
}

/** YYYY-MM-DD `days` from today (UTC). */
function dateFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('guardian oversight callables', () => {
  let seed: SeedData;
  let parent1Token: string; // family1 (supervising)
  let parent2Token: string; // family1 co-parent
  let parent3Token: string; // family2 (NOT supervising)
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent2Token = await getIdToken(seed.parent2.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  async function seedKid(
    uid: string,
    opts: {
      age?: number;
      governedBy?: string | null;
      babysitter?: { searchable: boolean };
      tutor?: { searchable: boolean };
    } = {},
  ) {
    counter += 1;
    const email = `oversight.kid${counter}@ejm.org`;
    const profiles: Record<string, unknown> = {};
    if (opts.babysitter) {
      profiles.babysitter = {
        enrollmentComplete: true,
        searchable: opts.babysitter.searchable,
        hourlyRate: 12,
        languages: ['French'],
      };
    }
    if (opts.tutor) {
      profiles.tutor = {
        enrollmentComplete: true,
        searchable: opts.tutor.searchable,
        subjects: [{ subject: 'math', levels: ['6e'], rate: 25 }],
        endorsementCount: 2,
      };
    }
    const docData: Record<string, unknown> = {
      uid,
      email,
      status: 'active',
      firstName: `Kid${counter}`,
      lastName: 'Oversight',
      dateOfBirth: new Date(dobWithAge(opts.age ?? 13)),
      language: 'en',
      profiles,
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (opts.governedBy) {
      docData.governedBy = { familyId: opts.governedBy, linkedAt: new Date() };
    }
    await getDb().collection('users').doc(uid).set(docData);
    return email;
  }

  async function seedLink(
    childUid: string,
    familyId: string,
    status: 'pending' | 'active' | 'revoked',
    origin: 'claim' | 'parent_created' = 'claim',
  ) {
    const link: Record<string, unknown> = {
      childUid,
      familyId,
      createdByParentUid: seed.parent1.uid,
      status,
      origin,
      requestedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
    };
    if (status === 'active') link.confirmedAt = new Date();
    if (status === 'revoked') link.revokedAt = new Date();
    await getDb().collection('guardianLinks').doc(childUid).set(link);
  }

  // ── getGovernedChildren ──

  describe('getGovernedChildren', () => {
    it('requires authentication', async () => {
      await expect(callFunction('getGovernedChildren', {})).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('a non-parent caller is refused', async () => {
      await seedKid('glKidSelf', { governedBy: seed.family1Id });
      await seedLink('glKidSelf', seed.family1Id, 'active');
      const kidToken = await getIdToken('glKidSelf');
      await expect(callFunction('getGovernedChildren', {}, kidToken)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { code: 'guardian/not-a-family-parent' },
      });
    });

    it('lists every supervised kid of the family with link status, profiles and age', async () => {
      await seedKid('glKid1', {
        age: 13,
        governedBy: seed.family1Id,
        babysitter: { searchable: true },
      });
      await seedLink('glKid1', seed.family1Id, 'active', 'parent_created');
      await seedKid('glKid2', { age: 16, tutor: { searchable: false } });
      await seedLink('glKid2', seed.family1Id, 'pending');
      await seedKid('glKid3', { age: 16 });
      await seedLink('glKid3', seed.family1Id, 'revoked');

      const result = await callFunction<{
        children: Array<Record<string, any>>;
        invites: Array<Record<string, any>>;
      }>('getGovernedChildren', {}, parent1Token);

      const byUid = Object.fromEntries(result.children.map((c) => [c.childUid, c]));
      expect(byUid.glKid1).toBeTruthy();
      expect(byUid.glKid2).toBeTruthy();
      expect(byUid.glKid3).toBeTruthy();

      // Active parent-created kid with a babysitter profile.
      expect(byUid.glKid1.link.status).toBe('active');
      expect(byUid.glKid1.link.origin).toBe('parent_created');
      expect(byUid.glKid1.age).toBe(13);
      expect(byUid.glKid1.firstName).toMatch(/^Kid/);
      expect(byUid.glKid1.profiles.babysitter).toMatchObject({ searchable: true });
      expect(byUid.glKid1.profiles.tutor).toBeNull();

      // Pending claim shows as awaiting confirmation.
      expect(byUid.glKid2.link.status).toBe('pending');
      expect(byUid.glKid2.profiles.tutor).toMatchObject({ searchable: false });

      // Revoked rows stay visible, labelled.
      expect(byUid.glKid3.link.status).toBe('revoked');

      // The other family's parent sees none of them.
      const other = await callFunction<{ children: Array<Record<string, any>> }>(
        'getGovernedChildren',
        {},
        parent3Token,
      );
      const otherUids = other.children.map((c) => c.childUid);
      expect(otherUids).not.toContain('glKid1');
      expect(otherUids).not.toContain('glKid2');
      expect(otherUids).not.toContain('glKid3');
    });

    it('counts upcoming confirmed commitments in the next 30 days', async () => {
      await seedKid('glKid4', {
        governedBy: seed.family1Id,
        babysitter: { searchable: true },
        tutor: { searchable: true },
      });
      await seedLink('glKid4', seed.family1Id, 'active', 'parent_created');

      // Two confirmed sit appointments in-window, one out-of-window, one pending.
      await seedAppointment({
        babysitterUserId: 'glKid4',
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'confirmed',
        date: dateFromToday(3),
      });
      await seedAppointment({
        babysitterUserId: 'glKid4',
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'confirmed',
        date: dateFromToday(10),
      });
      await seedAppointment({
        babysitterUserId: 'glKid4',
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'confirmed',
        date: dateFromToday(45), // beyond the 30-day window
      });
      await seedAppointment({
        babysitterUserId: 'glKid4',
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'pending',
        date: dateFromToday(4),
      });

      // One confirmed one_time study session in-window + one scheduled
      // instance of a confirmed recurring session in-window.
      await getDb().collection('study-sessions').doc('glSes1').set({
        sessionId: 'glSes1',
        tutorUserId: 'glKid4',
        familyId: seed.family2Id,
        familyName: 'Martin',
        type: 'one_time',
        status: 'confirmed',
        date: dateFromToday(5),
        startTime: '17:00',
        endTime: '18:00',
        subject: 'math',
        level: '6e',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await getDb().collection('study-sessions').doc('glSes2').set({
        sessionId: 'glSes2',
        tutorUserId: 'glKid4',
        familyId: seed.family2Id,
        familyName: 'Martin',
        type: 'recurring',
        status: 'confirmed',
        subject: 'english',
        level: '6e',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await getDb()
        .collection('study-sessions')
        .doc('glSes2')
        .collection('instances')
        .doc(dateFromToday(7))
        .set({
          sessionId: 'glSes2',
          tutorUserId: 'glKid4',
          familyId: seed.family2Id,
          date: dateFromToday(7),
          startTime: '17:00',
          endTime: '18:00',
          status: 'scheduled',
        });
      await getDb()
        .collection('study-sessions')
        .doc('glSes2')
        .collection('instances')
        .doc(dateFromToday(40))
        .set({
          sessionId: 'glSes2',
          tutorUserId: 'glKid4',
          familyId: seed.family2Id,
          date: dateFromToday(40), // beyond the window
          startTime: '17:00',
          endTime: '18:00',
          status: 'scheduled',
        });

      const result = await callFunction<{ children: Array<Record<string, any>> }>(
        'getGovernedChildren',
        {},
        parent1Token,
      );
      const kid = result.children.find((c) => c.childUid === 'glKid4')!;
      expect(kid.upcoming).toEqual({ sitAppointments: 2, studySessions: 2 });
    });

    it('includes the family pending invites with their expiry', async () => {
      await getDb().collection('kidInvites').doc('glInvite1').set({
        kidEmailLower: 'invitee.kid@ejm.org',
        firstName: 'Invitee',
        lastName: 'Kid',
        dateOfBirth: dobWithAge(12),
        familyId: seed.family1Id,
        createdByParentUid: seed.parent1.uid,
        tokenHash: 'x'.repeat(64),
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000),
        consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
      });
      await getDb().collection('kidInvites').doc('glInvite2').set({
        kidEmailLower: 'cancelled.kid@ejm.org',
        firstName: 'Cancelled',
        lastName: 'Kid',
        dateOfBirth: dobWithAge(12),
        familyId: seed.family1Id,
        createdByParentUid: seed.parent1.uid,
        tokenHash: 'y'.repeat(64),
        status: 'cancelled',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000),
        consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
      });

      const result = await callFunction<{ invites: Array<Record<string, any>> }>(
        'getGovernedChildren',
        {},
        parent2Token, // the co-parent holds identical rights
      );
      const mine = result.invites.find((i) => i.kidEmail === 'invitee.kid@ejm.org');
      expect(mine).toBeTruthy();
      expect(mine!.firstName).toBe('Invitee');
      expect(mine!.expiresAt).toBeTruthy();
      // Non-pending invites are not dashboard rows.
      expect(result.invites.some((i) => i.kidEmail === 'cancelled.kid@ejm.org')).toBe(false);
    });
  });

  // ── getGovernedChildDetail ──

  describe('getGovernedChildDetail', () => {
    it('requires an ACTIVE link held by the caller family', async () => {
      // Pending link → denied (oversight starts at consent) …
      await seedKid('gdKid1', { tutor: { searchable: true } });
      await seedLink('gdKid1', seed.family1Id, 'pending');
      await expect(
        callFunction('getGovernedChildDetail', { childUid: 'gdKid1' }, parent1Token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'guardian/not-supervised' },
      });
      // … but the children list still shows the pending row.
      const list = await callFunction<{ children: Array<Record<string, any>> }>(
        'getGovernedChildren',
        {},
        parent1Token,
      );
      expect(list.children.some((c) => c.childUid === 'gdKid1')).toBe(true);

      // Revoked link → denied too.
      await seedKid('gdKid2');
      await seedLink('gdKid2', seed.family1Id, 'revoked');
      await expect(
        callFunction('getGovernedChildDetail', { childUid: 'gdKid2' }, parent1Token),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

      // Active link, but a DIFFERENT family's parent → same refusal.
      await seedKid('gdKid3', { governedBy: seed.family1Id });
      await seedLink('gdKid3', seed.family1Id, 'active');
      await expect(
        callFunction('getGovernedChildDetail', { childUid: 'gdKid3' }, parent3Token),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

      // The kid themself is not a parent.
      const kidToken = await getIdToken('gdKid3');
      await expect(
        callFunction('getGovernedChildDetail', { childUid: 'gdKid3' }, kidToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('returns the full oversight payload including ALL notes and messages (ruling 8)', async () => {
      await seedKid('gdKid4', {
        age: 14,
        governedBy: seed.family1Id,
        babysitter: { searchable: true },
        tutor: { searchable: true },
      });
      await seedLink('gdKid4', seed.family1Id, 'active', 'parent_created');

      // A weekly schedule + one override.
      await getDb()
        .collection('schedules')
        .doc('gdKid4')
        .set({ weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } });
      await getDb()
        .collection('schedules')
        .doc('gdKid4')
        .collection('overrides')
        .doc(dateFromToday(2))
        .set({ date: dateFromToday(2), type: 'custom', slots: [] });

      // one_time study session carrying request message + both notes + a late
      // cancellation flag.
      await getDb().collection('study-sessions').doc('gdSes1').set({
        sessionId: 'gdSes1',
        tutorUserId: 'gdKid4',
        familyId: seed.family2Id,
        familyName: 'Martin',
        type: 'one_time',
        status: 'cancelled',
        statusReason: 'cancelled_by_family',
        cancellationReason: 'sick kid',
        lateCancellation: true,
        date: dateFromToday(2),
        startTime: '17:00',
        endTime: '18:00',
        subject: 'math',
        level: '6e',
        message: 'Nous cherchons de l aide en maths',
        preSessionNote: 'Please focus on fractions',
        postSessionNote: 'Great progress today',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // Recurring session whose instance carries its own notes.
      await getDb().collection('study-sessions').doc('gdSes2').set({
        sessionId: 'gdSes2',
        tutorUserId: 'gdKid4',
        familyId: seed.family2Id,
        familyName: 'Martin',
        type: 'recurring',
        status: 'confirmed',
        subject: 'english',
        level: '6e',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await getDb()
        .collection('study-sessions')
        .doc('gdSes2')
        .collection('instances')
        .doc(dateFromToday(6))
        .set({
          sessionId: 'gdSes2',
          tutorUserId: 'gdKid4',
          familyId: seed.family2Id,
          date: dateFromToday(6),
          startTime: '17:00',
          endTime: '18:00',
          status: 'scheduled',
          preSessionNote: 'Irregular verbs please',
          postSessionNote: 'Did well on the quiz',
        });

      // Pending booking + contact requests, both apps, with messages.
      await seedAppointment({
        appointmentId: 'gdApt1',
        babysitterUserId: 'gdKid4',
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'pending',
        date: dateFromToday(4),
        message: 'Saturday evening please',
      });
      await getDb().collection('studyContactRequests').doc('gdScr1').set({
        requestId: 'gdScr1',
        tutorUserId: 'gdKid4',
        familyId: seed.family2Id,
        familyName: 'Martin',
        parentName: 'Sophie Martin',
        createdByUserId: seed.parent3.uid,
        subject: 'math',
        level: '6e',
        status: 'pending',
        message: 'Can you help my kid?',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await getDb().collection('contactSharingRequests').doc('gdCsr1').set({
        requestId: 'gdCsr1',
        babysitterUserId: 'gdKid4',
        familyId: seed.family2Id,
        familyName: 'Martin',
        parentName: 'Sophie Martin',
        status: 'pending',
        createdAt: new Date(),
      });

      const detail = await callFunction<Record<string, any>>(
        'getGovernedChildDetail',
        { childUid: 'gdKid4' },
        parent1Token,
      );

      // Child + link + both provider profiles.
      expect(detail.child).toMatchObject({
        childUid: 'gdKid4',
        lastName: 'Oversight',
        age: 14,
        identityLocked: false,
      });
      expect(detail.link).toMatchObject({ status: 'active', origin: 'parent_created' });
      expect(detail.providerProfiles.babysitter).toMatchObject({ searchable: true });
      expect(detail.providerProfiles.tutor).toMatchObject({ searchable: true });
      expect(detail.providerProfiles.tutor.subjects[0]).toMatchObject({ subject: 'math' });

      // Schedule summary.
      expect(detail.schedule.weekly).toBeTruthy();
      expect(detail.schedule.overrideCount).toBe(1);

      // Ruling 8: sessions come with message + BOTH notes + lateCancellation.
      const ses1 = detail.study.sessions.find((s: any) => s.sessionId === 'gdSes1');
      expect(ses1).toMatchObject({
        status: 'cancelled',
        statusReason: 'cancelled_by_family',
        cancellationReason: 'sick kid',
        lateCancellation: true,
        message: 'Nous cherchons de l aide en maths',
        preSessionNote: 'Please focus on fractions',
        postSessionNote: 'Great progress today',
      });
      const ses2 = detail.study.sessions.find((s: any) => s.sessionId === 'gdSes2');
      expect(ses2.instances).toHaveLength(1);
      expect(ses2.instances[0]).toMatchObject({
        date: dateFromToday(6),
        preSessionNote: 'Irregular verbs please',
        postSessionNote: 'Did well on the quiz',
      });

      // Pending requests with their messages, both apps.
      expect(detail.study.contactRequests).toHaveLength(1);
      expect(detail.study.contactRequests[0]).toMatchObject({
        message: 'Can you help my kid?',
        status: 'pending',
      });
      const apt = detail.sit.appointments.find((a: any) => a.appointmentId === 'gdApt1');
      expect(apt).toMatchObject({ status: 'pending', message: 'Saturday evening please' });
      expect(detail.sit.contactSharingRequests).toHaveLength(1);
      expect(detail.sit.contactSharingRequests[0]).toMatchObject({
        parentName: 'Sophie Martin',
        status: 'pending',
      });

      // Endorsement/reference counts (endorsementCount seeded as 2).
      expect(detail.counts.endorsements).toBe(2);
      expect(detail.counts.references).toBe(0);
    });

    it('rejects a missing childUid', async () => {
      await expect(
        callFunction('getGovernedChildDetail', {}, parent1Token),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
