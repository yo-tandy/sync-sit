import { db } from '../config/firebase.js';

/** The states a community grant makes moot. See the docstring below. */
const OPEN_STATUSES = ['pending', 'rejected'] as const;

/**
 * A family verified through the community code flow no longer needs the
 * document requests the grant makes moot (issue #218). Mark them `superseded`.
 *
 * Two statuses, not one:
 * - **`pending`** — an admin reviewing it decides nothing; the family is
 *   already verified.
 * - **`rejected`** — the admin already decided it, the family routed around
 *   that decision through the community route, and nothing about the
 *   rejection is still actionable. Leaving it live was a real bug (PR #220
 *   review): `reviewVerification` recomputes each type's status from its
 *   documents, so a pre-grant rejected identity doc would surface as
 *   `identityStatus: 'rejected'` the next time an admin approved *anything*
 *   for that family — silently un-verifying a community-approved family, via
 *   an approval. The recompute has no notion of ordering, so it cannot tell a
 *   pre-grant rejection from a post-grant one; closing the pre-grant ones at
 *   grant time is what gives it that ordering.
 *
 * A rejection that lands AFTER the grant still wins, and should: that is a
 * real decision about a document the family chose to submit while already
 * verified.
 *
 * Only the community route calls this. The admin route cannot leave an open
 * doc behind by construction: it only reaches `isFullyVerified` when both
 * documents are approved, and `submitVerification` deletes any prior doc of
 * the same type.
 *
 * `superseded` rather than deleted: the row carries the uploaded file's
 * Storage path, so deleting it here would orphan the file. The record is not
 * permanent, though — `submitVerification` deletes every prior doc of a type
 * when the family re-uploads it, superseded ones included.
 *
 * Returns the ids that were superseded so callers can log what they closed.
 */
export async function supersedeOpenVerifications(
  familyId: string,
  now: Date,
): Promise<string[]> {
  // Filtered in memory rather than with `where('status', 'in', OPEN_STATUSES)`:
  // a family holds a handful of verification docs at most (submitVerification
  // deletes prior docs of a type on re-upload), and the single-field familyId
  // index serves this on its own. An `in` filter alongside the familyId
  // equality would lean on index merging, and there is no
  // (familyId, status) composite in firestore.indexes.json to fall back on.
  const all = await db
    .collection('verifications')
    .where('familyId', '==', familyId)
    .get();

  const open = all.docs.filter((doc) =>
    (OPEN_STATUSES as readonly string[]).includes(doc.data().status),
  );
  if (open.length === 0) return [];

  const batch = db.batch();
  for (const doc of open) {
    batch.update(doc.ref, {
      status: 'superseded',
      supersededAt: now,
      supersededBy: 'community',
    });
  }
  await batch.commit();

  return open.map((doc) => doc.id);
}
