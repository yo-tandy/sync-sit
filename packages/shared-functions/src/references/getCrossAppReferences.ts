import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  ENDORSEMENT_APPS,
  ENDORSEMENT_SUBJECT_FIELD,
  ENDORSEMENT_PER_SOURCE_LIMIT,
  PUBLIC_ENDORSEMENT_STATUSES,
  type EndorsementApp,
  type ProjectedCrossAppReference,
} from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

/**
 * Server-side projection for CROSS-APP `references` reads (issue #346,
 * follow-up from #280 / PR #337's review).
 *
 * Since #280, study-web and do-web queried the shared `references` collection
 * directly (`where(field,'==',uid).where('status','in',PUBLIC_ENDORSEMENT_STATUSES)`)
 * and received WHOLE sit reference documents — including third-party referee
 * PII (`refEmail`, `refPhone`, `refWhatsapp`, `numberOfKids`, `kidAges`) —
 * into browsers that render only `refName` / the endorsement text (sit itself
 * does the same for study/do docs it fetches). The rules already permitted
 * this (an approved/published reference is readable by any authenticated
 * user, H2-hardened), so this is PII minimisation, not a rules hole — see
 * `firestore.rules` and `crossAppEndorsements.ts`'s module header.
 *
 * This callable is the SIBLING-source fetcher: it runs the exact same query a
 * client used to run directly, via the admin SDK, and returns ONLY
 * {@link ProjectedCrossAppReference} — the fields a cross-app row actually
 * renders on ANY of the three surfaces (sit's SearchPage/
 * ExpandableBabysitterCard, study's TutorCard, do's OfferEndorsements). A
 * provider's OWN-app surface is untouched — it keeps reading the full
 * document directly, since that is the path where sit's referee contact
 * fields are meant to render.
 *
 * One call per source, mirroring the client's pre-existing
 * `Promise.allSettled` shape (sit-first, siblings after, degrade to fewer
 * entries rather than none) — NOT a batch of every sibling in one call, so
 * each client keeps its existing per-source partial-failure/retry semantics
 * unchanged; only the transport for sibling sources moved from a direct
 * Firestore read to this callable.
 */
const inputSchema = z.object({
  providerUserId: z.string().min(1),
  sourceApp: z.enum(ENDORSEMENT_APPS),
});

/** `data[key]` as a non-empty string, else `undefined` — mirrors `str()` in crossAppEndorsements.ts. */
function str(data: FirebaseFirestore.DocumentData, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function project(
  sourceApp: EndorsementApp,
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): ProjectedCrossAppReference {
  const data = doc.data();
  return {
    sourceApp,
    id: doc.id,
    refName: str(data, 'submittedByName') ?? str(data, 'refName') ?? '',
    text: str(data, 'referenceText') ?? str(data, 'note') ?? '',
    isEjmFamily: data.isEjmFamily === true,
  };
}

export const getCrossAppReferences = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request): Promise<{ items: ProjectedCrossAppReference[] }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const parsed = inputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'providerUserId and sourceApp are required');
    }
    const { providerUserId, sourceApp } = parsed.data;

    const snap = await db
      .collection('references')
      .where(ENDORSEMENT_SUBJECT_FIELD[sourceApp], '==', providerUserId)
      // LOAD-BEARING, same constraint the direct client query carried: keeps
      // the projection's business rule identical to the rule the client-side
      // read was already provable under (see crossAppEndorsements.ts). The
      // admin SDK bypasses rules, so this is not what makes the read legal —
      // it is what keeps a declined/pending reference from being projected.
      .where('status', 'in', PUBLIC_ENDORSEMENT_STATUSES)
      .limit(ENDORSEMENT_PER_SOURCE_LIMIT)
      .get();

    return { items: snap.docs.map((d) => project(sourceApp, d)) };
  },
);
