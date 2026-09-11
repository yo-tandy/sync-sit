import type { LatLng } from '../types/common.js';

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the aerial (great-circle) distance between two points
 * using the Haversine formula.
 * @returns Distance in kilometers
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * Comparator for a LAST tie-break by distance (issue #439): appended AFTER
 * every existing sort key, never above it. Nearer sorts first; a provider
 * with no computable distance (`null`/`undefined` — no root `address`, or the
 * family search had no `latLng`) sorts after every provider with one, but is
 * never excluded. Two providers with no distance, or the identical distance,
 * compare equal (0) — the caller's own tie-break, if any, or original
 * ordering decides from there.
 */
export function compareByDistanceLast(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}
