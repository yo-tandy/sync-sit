/**
 * Client-side helpers for the published-searches board (issue #207).
 *
 * One definition of the two predicates every board surface (provider pages,
 * app-bar badges, the families' own lists) shares:
 * - ACTIVE: there is no status field on publishedSearches docs — active means
 *   `expiresAt > now`. List rules cannot prove an expiry bound, so every
 *   client filters with this; the daily sweep bounds the residue to <24h.
 * - NEW (per provider): `createdAt > seenAt` STRICTLY — a doc whose createdAt
 *   equals the provider's stored publishedSearchesSeenAt has been seen (the
 *   seen-write races a same-instant publish at most once; never re-tag it).
 *   `seenAt == null` (never visited) makes every doc New.
 *
 * Timestamps are structural ({ toMillis() }) so admin-SDK, client-SDK, and
 * test fakes all fit; malformed/absent fields degrade CLOSED (not active,
 * not new) rather than throwing in a render path.
 */

interface TimestampLike {
  toMillis?: () => number;
}

function toMillis(value: TimestampLike | null | undefined): number | null {
  const ms = value?.toMillis?.();
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

export function isActivePublishedSearch(
  doc: { expiresAt?: TimestampLike | null },
  nowMs: number,
): boolean {
  const expires = toMillis(doc.expiresAt);
  return expires !== null && expires > nowMs;
}

export function isNewPublishedSearch(
  doc: { createdAt?: TimestampLike | null },
  seenAtMs: number | null,
): boolean {
  const created = toMillis(doc.createdAt);
  if (created === null) return false;
  return seenAtMs === null || created > seenAtMs;
}
