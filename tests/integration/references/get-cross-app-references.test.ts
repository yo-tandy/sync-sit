/**
 * Integration tests for `getCrossAppReferences` (issue #346, PII minimisation
 * follow-up from #280 / PR #337's review).
 *
 * Since #280, study-web and do-web queried the shared `references` collection
 * directly and received WHOLE sit reference documents — including third-party
 * referee PII (`refEmail`, `refPhone`, `refWhatsapp`, `numberOfKids`,
 * `kidAges`) — into browsers that render only `refName` / the endorsement
 * text. This callable is the server-side projection: it runs the identical
 * status-constrained query via the admin SDK and returns ONLY the fields a
 * cross-app row renders.
 *
 * The load-bearing assertion is the EXACT key set on a returned item — a
 * future field added to the projection must fail this test, not slip through
 * silently.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedReference, type SeedData } from '../../setup/seed.js';

interface ProjectedItem {
  sourceApp: string;
  id: string;
  refName: string;
  text: string;
  isEjmFamily: boolean;
}

/** Seed a `references` doc keyed by a non-babysitter subject field —
 * `seedReference` (tests/setup/seed.ts) only writes `babysitterUserId` docs,
 * so study/do-shaped fixtures are written directly here. */
async function seedSiblingReference(data: {
  field: 'tutorUserId' | 'doerUserId';
  providerUserId: string;
  status: 'pending' | 'approved' | 'published' | 'declined' | 'removed';
  submittedByName?: string;
  referenceText?: string;
  refEmail?: string;
  isEjmFamily?: boolean;
}): Promise<string> {
  const db = getDb();
  const ref = db.collection('references').doc();
  const doc: Record<string, unknown> = {
    [data.field]: data.providerUserId,
    type: 'family_submitted',
    status: data.status,
    createdAt: new Date(),
  };
  if (data.submittedByName !== undefined) doc.submittedByName = data.submittedByName;
  if (data.referenceText !== undefined) doc.referenceText = data.referenceText;
  if (data.refEmail !== undefined) doc.refEmail = data.refEmail;
  if (data.isEjmFamily !== undefined) doc.isEjmFamily = data.isEjmFamily;
  await ref.set(doc);
  return ref.id;
}

describe('getCrossAppReferences', () => {
  let seed: SeedData;
  let parent1Token: string;
  const db = getDb();

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    // Clear references between tests without re-seeding users.
    const refSnap = await db.collection('references').get();
    await Promise.all(refSnap.docs.map((d) => d.ref.delete()));
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(
      callFunction('getCrossAppReferences', {
        providerUserId: seed.tutor1.uid,
        sourceApp: 'study',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns ONLY the projected keys — sourceApp, id, refName, text, isEjmFamily', async () => {
    await seedSiblingReference({
      field: 'tutorUserId',
      providerUserId: seed.tutor1.uid,
      status: 'approved',
      submittedByName: 'Famille Etude',
      referenceText: 'Patient maths tutor',
      // PII that must never leave the server for a cross-app read.
      refEmail: 'leak@example.com',
      isEjmFamily: true,
    });

    const res = await callFunction<{ items: ProjectedItem[] }>(
      'getCrossAppReferences',
      { providerUserId: seed.tutor1.uid, sourceApp: 'study' },
      parent1Token,
    );

    expect(res.items).toHaveLength(1);
    const item = res.items[0];
    // Exact key set: a future field added to the projection (e.g. `refEmail`)
    // must fail this assertion, not slip through as an "extra" property.
    expect(Object.keys(item).sort()).toEqual(
      ['id', 'isEjmFamily', 'refName', 'sourceApp', 'text'].sort(),
    );
    expect(item.sourceApp).toBe('study');
    expect(item.refName).toBe('Famille Etude');
    expect(item.text).toBe('Patient maths tutor');
    expect(item.isEjmFamily).toBe(true);
    expect((item as unknown as Record<string, unknown>).refEmail).toBeUndefined();
  });

  it('honours the public-status constraint: a pending/declined reference is absent', async () => {
    await seedSiblingReference({
      field: 'tutorUserId',
      providerUserId: seed.tutor1.uid,
      status: 'pending',
      submittedByName: 'Not yet approved',
      referenceText: 'x',
    });
    await seedSiblingReference({
      field: 'tutorUserId',
      providerUserId: seed.tutor1.uid,
      status: 'declined',
      submittedByName: 'Declined',
      referenceText: 'x',
    });
    await seedSiblingReference({
      field: 'tutorUserId',
      providerUserId: seed.tutor1.uid,
      status: 'approved',
      submittedByName: 'Approved',
      referenceText: 'Visible',
    });
    await seedSiblingReference({
      field: 'tutorUserId',
      providerUserId: seed.tutor1.uid,
      status: 'published',
      submittedByName: 'Published',
      referenceText: 'Also visible',
    });

    const res = await callFunction<{ items: ProjectedItem[] }>(
      'getCrossAppReferences',
      { providerUserId: seed.tutor1.uid, sourceApp: 'study' },
      parent1Token,
    );

    const names = res.items.map((i) => i.refName).sort();
    expect(names).toEqual(['Approved', 'Published']);
  });

  it('handles a provider with no references (empty result, not an error)', async () => {
    const res = await callFunction<{ items: ProjectedItem[] }>(
      'getCrossAppReferences',
      { providerUserId: seed.tutor2.uid, sourceApp: 'study' },
      parent1Token,
    );
    expect(res.items).toEqual([]);
  });

  it('projects a doerUserId-keyed reference identically (the `do` source)', async () => {
    await seedSiblingReference({
      field: 'doerUserId',
      providerUserId: seed.babysitter1.uid,
      status: 'approved',
      submittedByName: 'Famille Bricolage',
      referenceText: 'Assembled our shelves',
    });

    const res = await callFunction<{ items: ProjectedItem[] }>(
      'getCrossAppReferences',
      { providerUserId: seed.babysitter1.uid, sourceApp: 'do' },
      parent1Token,
    );

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      sourceApp: 'do',
      refName: 'Famille Bricolage',
      text: 'Assembled our shelves',
    });
  });

  it('projects a babysitterUserId-keyed (sit) reference, mapping note/refName like the client mapper', async () => {
    // sit's manual-reference shape carries `note` + `refName` rather than
    // `referenceText` + `submittedByName` — the projection must tolerate
    // both, same as `toCrossAppEndorsement` in shared-core.
    await seedReference({
      babysitterUserId: seed.babysitter2.uid,
      type: 'manual',
      status: 'approved',
      fullName: 'ignored-by-projection',
    });
    await db
      .collection('references')
      .where('babysitterUserId', '==', seed.babysitter2.uid)
      .get()
      .then((snap) =>
        Promise.all(
          snap.docs.map((d) => d.ref.update({ refName: 'Famille Garde', note: 'Sat for two years' })),
        ),
      );

    const res = await callFunction<{ items: ProjectedItem[] }>(
      'getCrossAppReferences',
      { providerUserId: seed.babysitter2.uid, sourceApp: 'sit' },
      parent1Token,
    );

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      sourceApp: 'sit',
      refName: 'Famille Garde',
      text: 'Sat for two years',
    });
  });

  it('rejects a malformed sourceApp', async () => {
    await expect(
      callFunction(
        'getCrossAppReferences',
        { providerUserId: seed.tutor1.uid, sourceApp: 'not-a-real-app' },
        parent1Token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
