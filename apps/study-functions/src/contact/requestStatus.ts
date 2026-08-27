import { db } from '@ejm/shared-functions/config/firebase.js';

/**
 * The ONE resolution of "this family's contact-request status toward each
 * tutor" (extracted in PR #254 round 3 -- searchTutors and lookupTutor
 * carried near-verbatim copies that could drift):
 *
 * - Latest request per pair wins, by createdAt.
 * - A TUTOR-initiated request that is still pending is not something this
 *   family sent, so it must not render as "request sent" (issue #207 PR4).
 *   It cannot read as a fresh 'none' either: the send CTA that offers would
 *   be rejected as already-exists (PR #213 review). It gets its own status,
 *   'incoming', and the card points at the page where Accept lives.
 * - Once ACCEPTED the direction stops mattering -- contact is unlocked
 *   either way -- and a tutor-initiated closed request (declined/cancelled)
 *   is not this family's history at all, so it stays out.
 * - Unknown/withdrawn stored values resolve to 'none': a family that
 *   cancelled its own request is free to re-send, so surfaces must show the
 *   tutor as fresh rather than echoing the withdrawn state.
 */
export type FamilyRequestStatus = 'none' | 'pending' | 'accepted' | 'declined' | 'incoming';

const KNOWN_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'incoming'] as const;

export async function resolveFamilyRequestStatuses(
  familyId: string,
): Promise<(tutorId: string) => FamilyRequestStatus> {
  const requestsSnap = await db.collection('studyContactRequests')
    .where('familyId', '==', familyId)
    .get();
  const latestRequest = new Map<string, { status: string; createdAtMs: number }>();
  requestsSnap.docs.forEach((d) => {
    const data = d.data();
    const tutorId = data.tutorUserId as string | undefined;
    if (!tutorId) return;
    const tutorInitiated = data.initiatedBy === 'tutor';
    if (tutorInitiated && data.status !== 'accepted' && data.status !== 'pending') return;
    const createdAtMs = data.createdAt?.toMillis
      ? data.createdAt.toMillis()
      : data.createdAt?.toDate
        ? data.createdAt.toDate().getTime()
        : 0;
    const prev = latestRequest.get(tutorId);
    if (!prev || createdAtMs >= prev.createdAtMs) {
      const status = tutorInitiated && data.status === 'pending'
        ? 'incoming'
        : (data.status as string);
      latestRequest.set(tutorId, { status, createdAtMs });
    }
  });
  return (tutorId: string) => {
    const latest = latestRequest.get(tutorId);
    return latest && (KNOWN_REQUEST_STATUSES as readonly string[]).includes(latest.status)
      ? (latest.status as FamilyRequestStatus)
      : 'none';
  };
}
