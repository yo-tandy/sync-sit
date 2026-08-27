import { db } from '../config/firebase.js';

/**
 * A family verified through the community code flow no longer needs the
 * document request still sitting in the admin queue — an admin reviewing it
 * decides nothing (issue #218). Mark those `pending` docs `superseded`.
 *
 * Only the community route calls this. The admin route cannot leave a pending
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
export async function supersedePendingVerifications(
  familyId: string,
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
      supersededBy: 'community',
    });
  }
  await batch.commit();

  return pending.docs.map((doc) => doc.id);
}
