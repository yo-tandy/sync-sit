import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// guardianSetChildSearchable — the "hide from search" protective control.

const CONSENT = {
  tosVersion: '1.0',
  privacyVersion: '1.0',
  supervisionAgreementVersion: '1.0',
};

describe('guardianSetChildSearchable', () => {
  let seed: SeedData;
  let parent1Token: string; // family1 (supervising)
  let parent3Token: string; // family2
  let counter = 0;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  async function seedKid(
    uid: string,
    opts: {
      babysitter?: { searchable: boolean };
      tutor?: { searchable: boolean };
      linkStatus?: 'pending' | 'active' | 'revoked';
    } = {},
  ) {
    counter += 1;
    const profiles: Record<string, unknown> = {};
    if (opts.babysitter) {
      profiles.babysitter = { enrollmentComplete: true, searchable: opts.babysitter.searchable };
    }
    if (opts.tutor) {
      profiles.tutor = { enrollmentComplete: true, searchable: opts.tutor.searchable };
    }
    const linkStatus = opts.linkStatus ?? 'active';
    await getDb()
      .collection('users')
      .doc(uid)
      .set({
        uid,
        email: `searchable.kid${counter}@ejm.org`,
        status: 'active',
        firstName: 'Kid',
        lastName: 'Searchable',
        dateOfBirth: new Date('2013-02-15'),
        language: 'en',
        profiles,
        notifPrefs: {},
        fcmTokens: [],
        ...(linkStatus === 'active'
          ? { governedBy: { familyId: seed.family1Id, linkedAt: new Date() } }
          : {}),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const link: Record<string, unknown> = {
      childUid: uid,
      familyId: seed.family1Id,
      createdByParentUid: seed.parent1.uid,
      status: linkStatus,
      origin: 'parent_created',
      requestedAt: new Date(),
      consent: { ...CONSENT, approvedAt: new Date(), approvedByUid: seed.parent1.uid },
    };
    if (linkStatus === 'active') link.confirmedAt = new Date();
    await getDb().collection('guardianLinks').doc(uid).set(link);
  }

  it('requires authentication', async () => {
    await expect(
      callFunction('guardianSetChildSearchable', {
        childUid: 'x',
        app: 'sit',
        searchable: false,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('validates its arguments', async () => {
    await expect(
      callFunction(
        'guardianSetChildSearchable',
        { childUid: 'x', app: 'nope', searchable: false },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      callFunction(
        'guardianSetChildSearchable',
        { childUid: 'x', app: 'sit', searchable: 'yes' },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      callFunction(
        'guardianSetChildSearchable',
        { app: 'sit', searchable: false },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('a supervising parent hides the sit profile from search and the kid is told', async () => {
    await seedKid('scKid1', { babysitter: { searchable: true } });

    const result = await callFunction(
      'guardianSetChildSearchable',
      { childUid: 'scKid1', app: 'sit', searchable: false },
      parent1Token,
    );
    expect(result).toEqual({ success: true });

    const kid = (await getDb().collection('users').doc('scKid1').get()).data()!;
    expect(kid.profiles.babysitter.searchable).toBe(false);

    // Kid-facing notification.
    const notifs = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', 'scKid1')
      .get();
    const mine = notifs.docs.map((d) => d.data()).filter((n) => n.type === 'guardian_searchable');
    expect(mine.length).toBe(1);

    // Audit records the guardian actor.
    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'guardian.set_child_searchable')
      .get();
    const entry = audits.docs.map((d) => d.data()).find((a) => a.targetUserId === 'scKid1')!;
    expect(entry.adminUserId).toBe(seed.parent1.uid);
    expect(entry.details.actorRole).toBe('guardian');
    expect(entry.details.app).toBe('sit');
    expect(entry.details.searchable).toBe(false);
  });

  it('flips the study profile too, and can restore visibility', async () => {
    await seedKid('scKid2', { tutor: { searchable: false } });

    await callFunction(
      'guardianSetChildSearchable',
      { childUid: 'scKid2', app: 'study', searchable: true },
      parent1Token,
    );
    const kid = (await getDb().collection('users').doc('scKid2').get()).data()!;
    expect(kid.profiles.tutor.searchable).toBe(true);
  });

  it('refuses when the child has no profile in that app', async () => {
    await seedKid('scKid3', { tutor: { searchable: true } });
    await expect(
      callFunction(
        'guardianSetChildSearchable',
        { childUid: 'scKid3', app: 'sit', searchable: false },
        parent1Token,
      ),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'guardian/no-profile' },
    });
  });

  it('denies a parent of another family, a pending link, and the kid themself', async () => {
    await seedKid('scKid4', { babysitter: { searchable: true } });
    await expect(
      callFunction(
        'guardianSetChildSearchable',
        { childUid: 'scKid4', app: 'sit', searchable: false },
        parent3Token,
      ),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    await seedKid('scKid5', { babysitter: { searchable: true }, linkStatus: 'pending' });
    await expect(
      callFunction(
        'guardianSetChildSearchable',
        { childUid: 'scKid5', app: 'sit', searchable: false },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    const kidToken = await getIdToken('scKid4');
    await expect(
      callFunction(
        'guardianSetChildSearchable',
        { childUid: 'scKid4', app: 'sit', searchable: false },
        kidToken,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Nothing flipped anywhere.
    const kid = (await getDb().collection('users').doc('scKid4').get()).data()!;
    expect(kid.profiles.babysitter.searchable).toBe(true);
  });
});
