import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  listFamiliesInputSchema,
  type FamilyDoc,
  type KidDoc,
} from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';

interface ParentSummary {
  uid: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: string | null;
}

interface AdminFamilyRow {
  familyId: string;
  familyName: string;
  address: string;
  status: string;
  createdAt: string | null;
  verified: boolean;
  parents: ParentSummary[];
  kids: { firstName: string; age: number }[];
  kidsCount: number;
  governedKidsCount: number;
  preferredCount: number;
}

type FamilyRecord = { id: string; data: Partial<FamilyDoc> };

/** Batched parent join: one getAll over the unique parent uids (no N+1). */
async function loadParents(
  families: FamilyRecord[],
): Promise<Map<string, ParentSummary>> {
  const uids = [
    ...new Set(families.flatMap((f) => f.data.parentIds ?? [])),
  ];
  const map = new Map<string, ParentSummary>();
  if (uids.length === 0) return map;

  const snaps = await db.getAll(
    ...uids.map((uid) => db.collection('users').doc(uid)),
  );
  for (const snap of snaps) {
    const data = snap.data() as Record<string, unknown> | undefined;
    map.set(snap.id, {
      uid: snap.id,
      firstName: (data?.firstName as string) ?? null,
      lastName: (data?.lastName as string) ?? null,
      email: (data?.email as string) ?? null,
      status: (data?.status as string) ?? null,
    });
  }
  return map;
}

function parentsOf(
  family: FamilyRecord,
  parentMap: Map<string, ParentSummary>,
): ParentSummary[] {
  return (family.data.parentIds ?? []).map(
    (uid) =>
      parentMap.get(uid) ?? {
        uid,
        firstName: null,
        lastName: null,
        email: null,
        status: null,
      },
  );
}

/**
 * List families with parent/kid joins and optional search, status, and
 * verified filters. Mirrors listUsers: search is in-memory case-insensitive
 * (small community); status and verified are also filtered in-memory because
 * the base query orders by createdAt desc and a `status ==` predicate on top
 * of that would require a new composite index.
 */
export const listFamilies = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const parsed = listFamiliesInputSchema.safeParse(request.data ?? {});
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid listFamilies input',
      );
    }
    const { searchQuery, statusFilter, verifiedFilter, limit, startAfterId } =
      parsed.data;

    let query: FirebaseFirestore.Query = db
      .collection('families')
      .orderBy('createdAt', 'desc');

    if (startAfterId) {
      const startAfterDoc = await db
        .collection('families')
        .doc(startAfterId)
        .get();
      // A stale/unknown cursor must ERROR, not silently restart at page 1 —
      // the client appends cursor pages, so page 1 again means duplicated rows.
      if (!startAfterDoc.exists) {
        throw new HttpsError('invalid-argument', 'Unknown pagination cursor');
      }
      query = query.startAfter(startAfterDoc);
    }

    // Fetch a larger window when any in-memory filter is active (same
    // approach as listUsers); otherwise limit + 1 to compute hasMore.
    const hasInMemoryFilter =
      Boolean(searchQuery) ||
      statusFilter !== undefined ||
      verifiedFilter !== undefined;
    const fetchLimit = hasInMemoryFilter ? 500 : limit + 1;
    const snapshot = await query.limit(fetchLimit).get();

    let families: FamilyRecord[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Partial<FamilyDoc>,
    }));

    if (statusFilter) {
      families = families.filter((f) => f.data.status === statusFilter);
    }

    if (verifiedFilter !== undefined) {
      families = families.filter(
        (f) => (f.data.verification?.isFullyVerified ?? false) === verifiedFilter,
      );
    }

    // Search matches the family name OR any parent name/email, so the parent
    // join must happen over the whole filtered window before slicing the page.
    // Without a search we only join the parents of the returned page.
    let parentMap = new Map<string, ParentSummary>();
    if (searchQuery) {
      parentMap = await loadParents(families);
      const lowerSearch = searchQuery.toLowerCase();
      families = families.filter((f) => {
        if ((f.data.familyName ?? '').toLowerCase().includes(lowerSearch)) {
          return true;
        }
        return parentsOf(f, parentMap).some(
          (p) =>
            (p.firstName ?? '').toLowerCase().includes(lowerSearch) ||
            (p.lastName ?? '').toLowerCase().includes(lowerSearch) ||
            (p.email ?? '').toLowerCase().includes(lowerSearch),
        );
      });
    }

    const hasMore = families.length > limit;
    const page = families.slice(0, limit);
    if (!searchQuery) {
      parentMap = await loadParents(page);
    }

    const rows: AdminFamilyRow[] = await Promise.all(
      page.map(async (f) => {
        // Kids live in the families/{id}/kids subcollection (same docs the
        // sit family-settings page edits). Reads are bounded by page size.
        const kidsSnap = await db
          .collection('families')
          .doc(f.id)
          .collection('kids')
          .get();
        const kids = kidsSnap.docs.map((k) => {
          const kid = k.data() as Partial<KidDoc>;
          return { firstName: kid.firstName ?? '', age: kid.age ?? 0 };
        });

        // One equality count per family — acceptable at admin scale (page
        // size ≤ 100, and it's an aggregate query, not a document read).
        // ACTIVE links only: a pending claim or a revoked supervision is not
        // a governed kid, and showing it as one would misread the GDPR state.
        const governedSnap = await db
          .collection('guardianLinks')
          .where('familyId', '==', f.id)
          .where('status', '==', 'active')
          .count()
          .get();

        const createdAt = f.data.createdAt as
          | { toDate?: () => Date }
          | undefined;

        return {
          familyId: f.id,
          familyName: f.data.familyName ?? '',
          address: f.data.address ?? '',
          status: f.data.status ?? 'active',
          createdAt: createdAt?.toDate?.()?.toISOString() ?? null,
          verified: f.data.verification?.isFullyVerified ?? false,
          parents: parentsOf(f, parentMap),
          kids,
          kidsCount: kids.length,
          governedKidsCount: governedSnap.data().count,
          preferredCount: (f.data.preferredBabysitters ?? []).length,
        };
      }),
    );

    return { families: rows, hasMore };
  },
);
