import type { DocumentData, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

// Page per sweep query: bounds each read AND keeps the page's batched write
// under Firestore's 500-op cap.
const PAGE_SIZE = 300;

interface Sweep {
  collection: string;
  /** The denormalized name field this sweep rewrites. */
  field: string;
  value: string;
  query: Query<DocumentData>;
  /** In-code refinement for the legacy createdByUserId sweeps (see below). */
  guard?: (data: DocumentData) => boolean;
}

export interface NameFanOutSummary {
  /** Docs rewritten, per collection and field (0 = swept, nothing matched). */
  updated: Record<string, Record<string, number>>;
  /** `collection.field: message` for sweeps that failed (partial fan-out). */
  errors: string[];
}

/**
 * Refresh the denormalized display-name copies of a corrected root identity
 * (issue #273). Denormalization is deliberate — e.g. parents cannot read
 * tutor user docs under the rules, so `tutorName` lives on the session — but
 * it froze the pre-correction name forever. Called by BOTH correction
 * callables (admin correctUserIdentity, guardian correctChildIdentity) after
 * the users/{uid} update has committed.
 *
 * Attribution per sweep:
 * - `tutorName`: `tutorUserId` exists on every session/contact-request doc.
 * - `parentName`: `parentUserId` (new at the fill sites with this change),
 *   plus a legacy sweep on `createdByUserId` for pre-#273 docs — attributable
 *   only when the doc was CREATED by its parent, i.e. `tutorUserId !==
 *   createdByUserId` (provider-side docs have the two equal, and their
 *   parentName belongs to whoever later confirmed — unrecoverable from the
 *   doc, accepted as unreachable). The `!parentUserId` guard keeps new docs
 *   from being double-written by both parentName sweeps.
 * - `submittedByName`: study endorsements only (`appSource == 'study'`) — sit
 *   family endorsements store the free-text refName there, NOT the
 *   submitter's account name, and must not be rewritten.
 *
 * Error semantics: each sweep is independent; a failed sweep is recorded in
 * `errors` and never aborts the correction (already committed) or the other
 * sweeps. The caller puts the summary into the audit entry.
 */
export async function fanOutNameCorrections(
  targetUserId: string,
  newFirstName: string,
  newLastName: string,
): Promise<NameFanOutSummary> {
  const fullName = `${newFirstName} ${newLastName}`.trim();
  // contactSharingRequests' sit format (addPreferredBabysitter): LAST in caps.
  const sitParentName = `${newFirstName} ${newLastName.toUpperCase()}`.trim();

  const legacyParentGuard = (data: DocumentData) =>
    !data.parentUserId && data.tutorUserId !== targetUserId;

  const sweeps: Sweep[] = [
    {
      collection: 'study-sessions',
      field: 'tutorName',
      value: fullName,
      query: db.collection('study-sessions').where('tutorUserId', '==', targetUserId),
    },
    {
      collection: 'study-sessions',
      field: 'parentName',
      value: fullName,
      query: db.collection('study-sessions').where('parentUserId', '==', targetUserId),
    },
    {
      collection: 'study-sessions',
      field: 'parentName',
      value: fullName,
      query: db.collection('study-sessions').where('createdByUserId', '==', targetUserId),
      guard: legacyParentGuard,
    },
    {
      collection: 'studyContactRequests',
      field: 'tutorName',
      value: fullName,
      query: db.collection('studyContactRequests').where('tutorUserId', '==', targetUserId),
    },
    {
      collection: 'studyContactRequests',
      field: 'parentName',
      value: fullName,
      query: db.collection('studyContactRequests').where('parentUserId', '==', targetUserId),
    },
    {
      collection: 'studyContactRequests',
      field: 'parentName',
      value: fullName,
      query: db.collection('studyContactRequests').where('createdByUserId', '==', targetUserId),
      guard: legacyParentGuard,
    },
    {
      collection: 'contactSharingRequests',
      field: 'parentName',
      value: sitParentName,
      query: db.collection('contactSharingRequests').where('parentUserId', '==', targetUserId),
    },
    {
      collection: 'references',
      field: 'submittedByName',
      value: fullName,
      query: db
        .collection('references')
        .where('appSource', '==', 'study')
        .where('submittedByUserId', '==', targetUserId),
    },
  ];

  const summary: NameFanOutSummary = { updated: {}, errors: [] };
  for (const sweep of sweeps) {
    const perCollection = (summary.updated[sweep.collection] ??= {});
    perCollection[sweep.field] ??= 0;
    try {
      let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
      for (;;) {
        let page = sweep.query.limit(PAGE_SIZE);
        if (cursor) page = page.startAfter(cursor);
        const snap = await page.get();
        const targets = sweep.guard
          ? snap.docs.filter((doc) => sweep.guard!(doc.data()))
          : snap.docs;
        if (targets.length > 0) {
          const batch = db.batch();
          const now = new Date();
          for (const doc of targets) {
            batch.update(doc.ref, { [sweep.field]: sweep.value, updatedAt: now });
          }
          await batch.commit();
          perCollection[sweep.field] += targets.length;
        }
        if (snap.size < PAGE_SIZE) break;
        cursor = snap.docs[snap.docs.length - 1];
      }
    } catch (err) {
      summary.errors.push(
        `${sweep.collection}.${sweep.field}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return summary;
}
