import {
  endorsementResubmissionState,
  type EndorsementResubmissionState,
} from '@ejm/shared-core';

/**
 * Reads every timestamp shape a `references` doc's `updatedAt` could
 * plausibly carry — a live Firestore Timestamp (admin or client SDK), a
 * plain `Date` (what `doSubmitEndorsement` writes instead of a server
 * timestamp; see its own header comment on why), or, defensively, anything
 * unreadable resolves to epoch 0 rather than throwing — an unreadable
 * timestamp must not crash the callable it gates.
 */
function tsMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const v = value as { toMillis?: () => number; toDate?: () => Date } | null;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  return 0;
}

export interface EndorsementResubmissionQuery {
  /** Discriminates the shared `references` collection by product. */
  appSource: 'study' | 'do';
  /** The `references` field the recipient is keyed by for this app. */
  subjectField: 'tutorUserId' | 'doerUserId';
  /** The endorsement recipient's uid. */
  subjectUserId: string;
  /** The submitting family. */
  familyId: string;
}

/**
 * The ONE dedup/cool-down check both `submitTutorEndorsement` (study) and
 * `doSubmitEndorsement` (do) gate their write on (issue #356, option (b)):
 * a family may not endorse a recipient twice while a LIVE request exists,
 * and after a decline must wait out `ENDORSEMENT_RESUBMISSION_COOLDOWN_DAYS`
 * (shared-core) before trying again.
 *
 * Living here, not duplicated per app, is the fix for the issue's actual
 * complaint: two callables answering "can this family ask again?"
 * differently because each ran its own copy of the rule.
 *
 * Query shape: three EQUALITY filters (`appSource`, `subjectField`,
 * `submittedByFamilyId`), NO orderBy — Firestore serves pure-equality
 * queries by merging single-field indexes, so this needs no composite index,
 * matching the existing dedup queries it replaces
 * (`submitTutorEndorsement.ts`'s old inline query, do's
 * `findQualifyingCompletedTask` in `endorsementAccess.ts`). Recency is
 * picked in memory by `endorsementResubmissionState`, not by an `orderBy`
 * that would demand a composite index.
 *
 * `tx`, optional: do's `doSubmitEndorsement` wraps its whole dedup-then-write
 * in a transaction for race-safety (issue #357 item 2) — pass the
 * transaction so this read joins it (`tx.get(query)`, the transaction
 * read-before-write rule). study's `submitTutorEndorsement` is not
 * transactional (unchanged by this issue) and omits it, matching its
 * existing best-effort query-then-set shape.
 */
export async function checkEndorsementResubmission(
  db: FirebaseFirestore.Firestore,
  query: EndorsementResubmissionQuery,
  opts: { now?: Date; tx?: FirebaseFirestore.Transaction } = {},
): Promise<EndorsementResubmissionState> {
  const q = db
    .collection('references')
    .where('appSource', '==', query.appSource)
    .where(query.subjectField, '==', query.subjectUserId)
    .where('submittedByFamilyId', '==', query.familyId);

  const snap = opts.tx ? await opts.tx.get(q) : await q.get();

  return endorsementResubmissionState(
    snap.docs.map((doc) => {
      const data = doc.data();
      return {
        status: typeof data.status === 'string' ? data.status : '',
        updatedAtMs: tsMillis(data.updatedAt),
      };
    }),
    opts.now ?? new Date(),
  );
}
