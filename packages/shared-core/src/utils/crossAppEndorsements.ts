/**
 * Cross-app endorsements: one registry for the shared `references` collection
 * (issue #280, owner decision from the sync-do plan review, PR #243).
 *
 * All three products vouch for a provider through the SAME collection, keyed
 * by a per-app subject field — sit's `ReferenceDoc.babysitterUserId`, study's
 * `TutorEndorsementDoc.tutorUserId`, and sync-do's `doerUserId`. A person who
 * sits on Sync/Sit and tutors on Sync/Study is one `users/{uid}`, so a search
 * result in either app can surface both — provided the reader knows WHICH app
 * each entry came from.
 *
 * Two invariants live here so no surface re-derives them:
 *
 * 1. ORDER. `endorsementSources(currentApp)` puts the current app's field
 *    first and the sibling apps after, in a stable registry order. Concatenate
 *    the query results in that order and "current app first, others after"
 *    falls out — no post-hoc sort, no per-surface tie-breaking.
 *
 * 2. STATUS. `PUBLIC_ENDORSEMENT_STATUSES` is the status set every cross-app
 *    query MUST constrain on. The H2-hardened `references` read rule grants an
 *    unrelated caller only the public-status disjunct, and Firestore can only
 *    prove that disjunct when the QUERY constrains status. An unconstrained
 *    query is PERMISSION_DENIED, and the fix is always the query shape — never
 *    widening the read rule.
 *
 * Adding a fourth product is a one-line registry entry plus its origin label:
 * every surface iterates the registry rather than hard-coding a field list.
 *
 * Deliberately firebase-free: shared-core is consumed by the client SDK apps
 * and by admin-SDK functions, which build queries with different APIs. This
 * module supplies the field names, the status constraint, the order, and the
 * doc→line mapping; each caller builds its own query.
 */

/** The products that write endorsements into the shared collection. */
export type EndorsementApp = 'sit' | 'study' | 'do';

/**
 * Registry order — the order sibling apps appear in after the current one.
 * Chronological by product launch; stable so two surfaces never disagree.
 */
export const ENDORSEMENT_APPS: readonly EndorsementApp[] = ['sit', 'study', 'do'];

/**
 * The `references` field each app keys its endorsements by. Each has a
 * `(field ASC, status ASC)` composite in firestore.indexes.json — the shape
 * `where(field,'==',uid) + where('status','in',PUBLIC_ENDORSEMENT_STATUSES)`
 * needs exactly that.
 */
export const ENDORSEMENT_SUBJECT_FIELD: Record<EndorsementApp, string> = {
  sit: 'babysitterUserId',
  study: 'tutorUserId',
  do: 'doerUserId',
};

/**
 * The statuses the read rule exposes to an unrelated caller. LOAD-BEARING as a
 * query constraint, not a display filter — see the module header.
 */
export const PUBLIC_ENDORSEMENT_STATUSES: readonly string[] = ['approved', 'published'];

export interface EndorsementSource {
  app: EndorsementApp;
  /** The `references` field to match the provider's uid against. */
  field: string;
}

/**
 * The sources a surface in `currentApp` should query, IN RENDER ORDER: the
 * current app first, siblings after in registry order.
 */
export function endorsementSources(currentApp: EndorsementApp): EndorsementSource[] {
  const ordered: EndorsementApp[] = [
    currentApp,
    ...ENDORSEMENT_APPS.filter((a) => a !== currentApp),
  ];
  return ordered.map((app) => ({ app, field: ENDORSEMENT_SUBJECT_FIELD[app] }));
}

/**
 * One endorsement as the search surfaces render it. The contact fields are
 * sit-only (a babysitter's manually-entered offline reference carries the
 * referee's phone/email); study and do docs simply leave them undefined.
 */
export interface CrossAppEndorsement {
  id: string;
  /** Which product this vouches for — decides the origin label. */
  sourceApp: EndorsementApp;
  refName: string;
  text: string;
  refEmail?: string;
  refPhone?: string;
  refWhatsapp?: string;
  isEjmFamily: boolean;
  numberOfKids?: number;
  kidAges?: number[];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Map a raw `references` doc onto a render line. Tolerant by design: the three
 * doc shapes overlap only partially (sit manual refs carry `note` where
 * family-submitted ones carry `referenceText`), and a surface that throws on an
 * unexpected sibling-app doc would take the whole card down with it.
 */
export function toCrossAppEndorsement(
  sourceApp: EndorsementApp,
  id: string,
  data: Record<string, unknown>,
): CrossAppEndorsement {
  const kidAges = data.kidAges;
  const numberOfKids = data.numberOfKids;
  return {
    id,
    sourceApp,
    refName: str(data.submittedByName) ?? str(data.refName) ?? '',
    text: str(data.referenceText) ?? str(data.note) ?? '',
    refEmail: str(data.refEmail),
    refPhone: str(data.refPhone),
    refWhatsapp: str(data.refWhatsapp),
    isEjmFamily: data.isEjmFamily === true,
    numberOfKids: typeof numberOfKids === 'number' ? numberOfKids : undefined,
    kidAges: Array.isArray(kidAges) ? (kidAges as number[]) : undefined,
  };
}
