/**
 * The decline cooldown shared by both directions of study contact
 * (issue #207 PR4). A "no" silences the other side for a week: without it the
 * refused party can re-mint a request on every tap, and each one notifies the
 * recipient by email, push and in-app.
 *
 * Which declines count depends on WHO is asking, which is the whole reason
 * this lives in one place: a family that declined a tutor's approach must stay
 * free to send its own request, and a tutor who declined a family's request
 * must stay free to answer that family's published search. Passing the
 * initiator whose declines should silence the caller keeps the two callables
 * from drifting apart on it.
 */
export const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function toMillis(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

/**
 * The most recent decline of a request opened by `initiatedBy`, in epoch ms,
 * or null when there is none.
 *
 * `initiatedBy: 'tutor'` selects requests the TUTOR opened (absent on legacy
 * docs, which are family-initiated by construction — the inversion is new).
 * A decline whose timestamp is unreadable is reported as NOW, so the cooldown
 * fails CLOSED: the alternative re-notifies someone who already said no.
 */
export function latestDeclineMs(
  docs: Record<string, unknown>[],
  initiatedBy: 'tutor' | 'family',
): number | null {
  let latest: number | null = null;
  for (const data of docs) {
    if (data.status !== 'declined') continue;
    const opener = data.initiatedBy === 'tutor' ? 'tutor' : 'family';
    if (opener !== initiatedBy) continue;
    const ms = toMillis(data.respondedAt) ?? toMillis(data.updatedAt) ?? toMillis(data.createdAt) ?? Date.now();
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}
