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

/** Does this doc represent a decline of a request opened by `initiatedBy`? */
function isDeclineBy(data: Record<string, unknown>, initiatedBy: 'tutor' | 'family'): boolean {
  if (data.status !== 'declined') return false;
  // `initiatedBy` is absent on legacy docs, which are family-initiated by
  // construction -- the inversion is new.
  const opener = data.initiatedBy === 'tutor' ? 'tutor' : 'family';
  return opener === initiatedBy;
}

/** The decline's own timestamp, or null when the doc carries none we can read. */
function declineMs(data: Record<string, unknown>): number | null {
  return toMillis(data.respondedAt) ?? toMillis(data.updatedAt) ?? toMillis(data.createdAt);
}

/**
 * The most recent decline of a request opened by `initiatedBy`, in epoch ms,
 * or null when there is none.
 *
 * `initiatedBy: 'tutor'` selects requests the TUTOR opened (absent on legacy
 * docs, which are family-initiated by construction — the inversion is new).
 * A decline whose timestamp is unreadable is reported as NOW, so the cooldown
 * fails CLOSED: the alternative re-notifies someone who already said no.
 *
 * Failing closed on NOW only bounds the window if something anchors it —
 * otherwise `Date.now() - declinedMs` is recomputed as ~0 on every call and
 * the pair is silenced forever rather than for a week (issue #214). Callers
 * anchor it by running `repairTimestamplessDeclines` first, which stamps the
 * corrupt doc so the week runs from the first attempt that hit it.
 */
export function latestDeclineMs(
  docs: Record<string, unknown>[],
  initiatedBy: 'tutor' | 'family',
): number | null {
  let latest: number | null = null;
  for (const data of docs) {
    if (!isDeclineBy(data, initiatedBy)) continue;
    const ms = declineMs(data) ?? Date.now();
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/** The minimum a caller needs from a query snapshot to repair a doc. */
type RepairableDoc = {
  data(): Record<string, unknown>;
  ref: { update(data: Record<string, unknown>): Promise<unknown> };
};

/**
 * Stamp `updatedAt` on declines of `initiatedBy`'s requests that carry no
 * readable timestamp, so the cooldown they trigger can age out.
 *
 * No write path we control produces such a doc — every one of them stamps
 * `updatedAt` — so this is for hand-edited rows and imports. Without it those
 * rows silence the pair permanently (issue #214); with it the caller still
 * refuses the attempt that found them (the in-memory data is unchanged, so
 * `latestDeclineMs` still reports NOW), and the week runs from that attempt.
 *
 * Best-effort by design: a repair that fails leaves the previous behaviour
 * exactly as it was, which is refusal, so it must never fail the caller.
 */
export async function repairTimestamplessDeclines(
  docs: RepairableDoc[],
  initiatedBy: 'tutor' | 'family',
  now: Date = new Date(),
): Promise<number> {
  const stale = docs.filter((d) => {
    const data = d.data();
    return isDeclineBy(data, initiatedBy) && declineMs(data) === null;
  });
  let repaired = 0;
  for (const d of stale) {
    try {
      await d.ref.update({ updatedAt: now });
      repaired += 1;
    } catch {
      // Leaves the doc unanchored; the caller refuses either way.
    }
  }
  return repaired;
}
