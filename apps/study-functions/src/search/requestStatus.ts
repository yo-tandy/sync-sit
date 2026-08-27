import type { TutorSearchResult } from '@ejm/study-core';

/**
 * Shared request-status projection for the family-facing tutor surfaces
 * (searchTutors and lookupTutor, issue #235). Both callables must answer the
 * same question with the same rules — "what is THIS family's contact-request
 * state toward this tutor?" — or the code-lookup card and the search card
 * would disagree about the very CTA they gate.
 */

/** The structural slice of a studyContactRequests doc this module reads. */
interface RequestDocData {
  tutorUserId?: string;
  initiatedBy?: string;
  status?: string;
  createdAt?: { toMillis?: () => number; toDate?: () => Date };
}

/** Minimal doc shape so unit tests need no Firestore snapshot machinery. */
export interface RequestDocLike {
  data: () => RequestDocData;
}

/**
 * Latest-wins request status per tutor for one family's request docs.
 *
 * A TUTOR-initiated request that is still pending is not something this
 * family sent, so it must not render the tutor's card as "request sent"
 * (issue #207 PR4). It cannot read as a fresh 'none' either: the send CTA
 * that offers would be rejected as already-exists, contradicting the card the
 * family just clicked (PR #213 review). It gets its own 'incoming' status,
 * and the card points at the page where Accept lives. Once ACCEPTED the
 * direction stops mattering — contact is unlocked either way — and a closed
 * one (declined/cancelled) is not this family's history at all, so it stays
 * out.
 */
export function latestRequestStatusByTutor(
  docs: RequestDocLike[],
): Map<string, { status: string; createdAtMs: number }> {
  const latest = new Map<string, { status: string; createdAtMs: number }>();
  docs.forEach((d) => {
    const data = d.data();
    const tutorId = data.tutorUserId;
    if (!tutorId) return;
    const tutorInitiated = data.initiatedBy === 'tutor';
    if (tutorInitiated && data.status !== 'accepted' && data.status !== 'pending') return;
    const createdAtMs = data.createdAt?.toMillis
      ? data.createdAt.toMillis()
      : data.createdAt?.toDate
        ? data.createdAt.toDate().getTime()
        : 0;
    const prev = latest.get(tutorId);
    if (!prev || createdAtMs >= prev.createdAtMs) {
      const status = tutorInitiated && data.status === 'pending'
        ? 'incoming'
        : (data.status as string);
      latest.set(tutorId, { status, createdAtMs });
    }
  });
  return latest;
}

/**
 * Whitelist the ACTIONABLE lifecycle statuses; anything else falls back to
 * 'none'. 'cancelled' is deliberately excluded here: a family that withdrew
 * its request is free to re-send, so the card must surface the tutor as
 * 'none' (fresh) rather than echoing the withdrawn state. Any other
 * unrecognized stored value likewise can't leak into the payload. 'incoming'
 * is latestRequestStatusByTutor's own value for a tutor-initiated pending.
 */
const KNOWN_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'incoming'] as const;

export function resolveRequestStatus(
  latest: { status: string } | undefined,
): TutorSearchResult['requestStatus'] {
  return latest && (KNOWN_REQUEST_STATUSES as readonly string[]).includes(latest.status)
    ? (latest.status as TutorSearchResult['requestStatus'])
    : 'none';
}
