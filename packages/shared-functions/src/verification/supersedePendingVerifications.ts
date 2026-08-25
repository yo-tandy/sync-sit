import { db } from '../config/firebase.js';

/**
 * A family can reach "verified" by two independent routes: an admin reviewing
 * uploaded documents, or the community code flow. Whichever lands first, any
 * document request still sitting at `pending` is now moot — the family is
 * already verified, so an admin reviewing it later decides nothing (issue
 * #218).
 *
 * Those docs are marked `superseded` rather than deleted: the row carries the
 * uploaded file's Storage path, and deleting it would orphan the file and drop
 * the audit trail. `superseded` keeps both while dropping the request out of
 * the admin queue's default `pending` filter.
 *
 * Returns the ids that were superseded so callers can log what they closed.
 */
export async function supersedePendingVerifications(
  familyId: string,
  supersededBy: 'community' | 'admin',
  now: Date,
): Promise<string[]> {
  const pending = await db
    .collection('verifications')
    .where('familyId', '==', familyId)
    .where('status', '==', 'pending')
    .get();

  if (pending.empty) return [];

  const batch = db.batch();
  for (const doc of pending.docs) {
    batch.update(doc.ref, {
      status: 'superseded',
      supersededAt: now,
      supersededBy,
    });
  }
  await batch.commit();

  return pending.docs.map((doc) => doc.id);
}
