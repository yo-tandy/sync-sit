import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

interface ParentSummary {
  uid: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: string | null;
}

interface KidSummary {
  firstName: string;
  age: number;
}

interface AdminFamilyRow {
  familyId: string;
  familyName: string;
  address: string;
  status: string;
  createdAt: string | null;
  verified: boolean;
  parents: ParentSummary[];
  kids: KidSummary[];
  kidsCount: number;
  governedKidsCount: number;
  preferredCount: number;
}

interface ListFamiliesResult {
  families: AdminFamilyRow[];
  hasMore: boolean;
}

const list = (data: Record<string, unknown>, token?: string) =>
  callFunction<ListFamiliesResult>('listFamilies', data, token);

describe('listFamilies admin callable', () => {
  let seed: SeedData;
  let adminToken: string;
  let parentToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parentToken = await getIdToken(seed.parent1.uid);

    const db = getDb();

    // Deterministic createdAt ordering (desc expected): deleted > martin > dupont.
    await db.collection('families').doc(seed.family1Id).update({
      createdAt: new Date('2026-01-01T10:00:00Z'),
      preferredBabysitters: [seed.babysitter1.uid, seed.babysitter2.uid],
    });
    await db.collection('families').doc(seed.family2Id).update({
      createdAt: new Date('2026-02-01T10:00:00Z'),
    });

    // A soft-deleted family — parentless, unverified, newest.
    await db.collection('families').doc('family-ghost').set({
      familyId: 'family-ghost',
      familyName: 'Ghost',
      address: '1 Rue Disparue, 75016 Paris',
      latLng: { lat: 48.85, lng: 2.27 },
      parentIds: [],
      preferredBabysitters: [],
      status: 'deleted',
      createdAt: new Date('2026-03-01T10:00:00Z'),
      updatedAt: new Date('2026-03-01T10:00:00Z'),
    });

    // A REVOKED link must not count as a governed kid (active-only pin).
    await db.collection('guardianLinks').doc('revoked-kid-uid').set({
      childUid: 'revoked-kid-uid',
      familyId: seed.family1Id,
      createdByParentUid: seed.parent1.uid,
      status: 'revoked',
      origin: 'claim',
      requestedAt: new Date(),
    });

    // One governed kid supervised by family 1 (guardianLinks doc id IS the child uid).
    await db.collection('guardianLinks').doc('governed-kid-uid').set({
      childUid: 'governed-kid-uid',
      familyId: seed.family1Id,
      createdByParentUid: seed.parent1.uid,
      status: 'active',
      origin: 'parent_created',
      requestedAt: new Date(),
      consent: {
        tosVersion: '1.0',
        privacyVersion: '1.0',
        supervisionAgreementVersion: '1.0',
        approvedAt: new Date(),
        approvedByUid: seed.parent1.uid,
      },
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  // -------------------------------------------------------------------------
  // Auth matrix
  // -------------------------------------------------------------------------

  it('non-admin caller gets permission-denied', async () => {
    await expect(list({}, parentToken)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('unauthenticated caller is rejected', async () => {
    await expect(list({})).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Listing, ordering, deleted visibility (mirrors listUsers: no status filter
  // means every status is returned, deleted included)
  // -------------------------------------------------------------------------

  it('returns all families ordered by createdAt desc, deleted included when unfiltered', async () => {
    const result = await list({}, adminToken);
    expect(result.families.map((f) => f.familyId)).toEqual([
      'family-ghost',
      seed.family2Id,
      seed.family1Id,
    ]);
    expect(result.hasMore).toBe(false);
  });

  it('joins parents, kids, counts, and verification state', async () => {
    const result = await list({}, adminToken);
    const dupont = result.families.find((f) => f.familyId === seed.family1Id)!;

    expect(dupont.familyName).toBe('Dupont');
    expect(dupont.address).toBe('15 Rue de Passy, 75016 Paris');
    expect(dupont.status).toBe('active');
    expect(dupont.verified).toBe(true);
    expect(dupont.createdAt).toBe('2026-01-01T10:00:00.000Z');

    expect(dupont.parents).toHaveLength(2);
    const marie = dupont.parents.find((p) => p.uid === seed.parent1.uid)!;
    expect(marie).toMatchObject({
      firstName: 'Marie',
      lastName: 'Dupont',
      email: 'marie.dupont@test.com',
      status: 'active',
    });
    expect(dupont.parents.map((p) => p.uid)).toContain(seed.parent2.uid);

    expect(dupont.kids).toHaveLength(2);
    expect(dupont.kids).toEqual(
      expect.arrayContaining([
        { firstName: 'Lucas', age: 6 },
        { firstName: 'Emma', age: 4 },
      ]),
    );
    expect(dupont.kidsCount).toBe(2);
    expect(dupont.governedKidsCount).toBe(1);
    expect(dupont.preferredCount).toBe(2);
  });

  it('reports zero counts and unverified state where nothing is joined', async () => {
    const result = await list({}, adminToken);

    const martin = result.families.find((f) => f.familyId === seed.family2Id)!;
    expect(martin.verified).toBe(false);
    expect(martin.parents).toHaveLength(1);
    expect(martin.parents[0].email).toBe('sophie.martin@test.com');
    expect(martin.kids).toEqual([{ firstName: 'Chloe', age: 7 }]);
    expect(martin.kidsCount).toBe(1);
    expect(martin.governedKidsCount).toBe(0);
    expect(martin.preferredCount).toBe(0);

    const ghost = result.families.find((f) => f.familyId === 'family-ghost')!;
    expect(ghost.verified).toBe(false);
    expect(ghost.parents).toEqual([]);
    expect(ghost.kids).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  it('statusFilter=active excludes deleted families', async () => {
    const result = await list({ statusFilter: 'active' }, adminToken);
    expect(result.families.map((f) => f.familyId)).toEqual([
      seed.family2Id,
      seed.family1Id,
    ]);
  });

  it('statusFilter=deleted returns only deleted families', async () => {
    const result = await list({ statusFilter: 'deleted' }, adminToken);
    expect(result.families.map((f) => f.familyId)).toEqual(['family-ghost']);
  });

  it('verifiedFilter narrows on verification.isFullyVerified (absent counts as false)', async () => {
    const verified = await list({ verifiedFilter: true }, adminToken);
    expect(verified.families.map((f) => f.familyId)).toEqual([seed.family1Id]);

    const unverified = await list({ verifiedFilter: false }, adminToken);
    expect(unverified.families.map((f) => f.familyId)).toEqual([
      'family-ghost',
      seed.family2Id,
    ]);
  });

  // -------------------------------------------------------------------------
  // Search (mirrors listUsers: in-memory, case-insensitive)
  // -------------------------------------------------------------------------

  it('searchQuery matches the family name case-insensitively', async () => {
    const result = await list({ searchQuery: 'DUPONT' }, adminToken);
    expect(result.families.map((f) => f.familyId)).toEqual([seed.family1Id]);
  });

  it('searchQuery matches a parent email', async () => {
    const result = await list({ searchQuery: 'sophie.martin@test.com' }, adminToken);
    expect(result.families.map((f) => f.familyId)).toEqual([seed.family2Id]);
  });

  it('searchQuery matches a parent first name', async () => {
    const result = await list({ searchQuery: 'pierre' }, adminToken);
    expect(result.families.map((f) => f.familyId)).toEqual([seed.family1Id]);
  });

  it('searchQuery with no match returns an empty page', async () => {
    const result = await list({ searchQuery: 'zzz-no-such-family' }, adminToken);
    expect(result.families).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Paging
  // -------------------------------------------------------------------------

  it('pages through families with limit + startAfterId cursor', async () => {
    const page1 = await list({ limit: 1 }, adminToken);
    expect(page1.families.map((f) => f.familyId)).toEqual(['family-ghost']);
    expect(page1.hasMore).toBe(true);

    const page2 = await list(
      { limit: 1, startAfterId: 'family-ghost' },
      adminToken,
    );
    expect(page2.families.map((f) => f.familyId)).toEqual([seed.family2Id]);
    expect(page2.hasMore).toBe(true);

    const page3 = await list(
      { limit: 1, startAfterId: seed.family2Id },
      adminToken,
    );
    expect(page3.families.map((f) => f.familyId)).toEqual([seed.family1Id]);
    expect(page3.hasMore).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Input validation (zod)
  // -------------------------------------------------------------------------

  it('rejects a limit above 100 with invalid-argument', async () => {
    await expect(list({ limit: 200 }, adminToken)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('rejects an unknown statusFilter with invalid-argument', async () => {
    await expect(
      list({ statusFilter: 'blocked' }, adminToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a stale/unknown startAfterId cursor instead of restarting at page 1', async () => {
    await expect(
      list({ startAfterId: 'no-such-family' }, adminToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
