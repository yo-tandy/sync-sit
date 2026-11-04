import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import {
  endorsementSources,
  toCrossAppEndorsement,
  ENDORSEMENT_PER_SOURCE_LIMIT,
  PUBLIC_ENDORSEMENT_STATUSES,
  type CrossAppEndorsement,
  type EndorsementApp,
  type ProjectedCrossAppReference,
} from '@ejm/shared-core';

/**
 * The per-source fetchers behind sit's cross-app endorsement rows (issue
 * #280, PII-minimised per issue #346). Shared by SearchPage and
 * ExpandableBabysitterCard so the own-app-vs-sibling split lives in ONE
 * place rather than two copies drifting apart.
 *
 * sit's OWN source (`babysitterUserId`) stays a direct client read of the
 * full `references` doc — sit's own expanded rows render the referee's
 * contact fields (`refEmail`/`refPhone`/`refWhatsapp`/`numberOfKids`/
 * `kidAges`) from it, gated on `sourceApp === 'sit'` at the render site.
 *
 * Every SIBLING source (study, do) instead calls the shared
 * `getCrossAppReferences` callable: the identical status-constrained query,
 * run server-side, returning ONLY the fields a cross-app row renders
 * (`sourceApp`, `id`, `refName`, `text`, `isEjmFamily`) — the referee PII
 * fields above never reach this browser for a study/do reference. See
 * `packages/shared-functions/src/references/getCrossAppReferences.ts`.
 *
 * One promise per source, matching the callers' existing
 * `Promise.allSettled` shape: a failing SIBLING source must not hide sit's
 * own primary signal, and the ORDER here (current app first) is what makes
 * "sit's own references lead" fall out of a plain concat.
 */
export function fetchEndorsementSources(
  providerUserId: string,
): { app: EndorsementApp; promise: Promise<CrossAppEndorsement[]> }[] {
  return endorsementSources('sit').map(({ app, field }) => ({
    app,
    promise:
      app === 'sit'
        ? getDocs(
            query(
              collection(db, 'references'),
              where(field, '==', providerUserId),
              // Load-bearing: the H2-hardened references read rule grants an
              // unrelated family only the public-status disjunct, provable
              // only from the QUERY. Without it the read is PERMISSION_DENIED
              // — and the fix is the query, never the rule.
              where('status', 'in', PUBLIC_ENDORSEMENT_STATUSES),
              limit(ENDORSEMENT_PER_SOURCE_LIMIT),
            ),
          ).then((snap) =>
            snap.docs.map((d) =>
              toCrossAppEndorsement(app, d.id, d.data() as Record<string, unknown>),
            ),
          )
        : httpsCallable<
            { providerUserId: string; sourceApp: EndorsementApp },
            { items: ProjectedCrossAppReference[] }
          >(functions, 'getCrossAppReferences')({ providerUserId, sourceApp: app }).then(
            (res) => res.data.items ?? [],
          ),
  }));
}
