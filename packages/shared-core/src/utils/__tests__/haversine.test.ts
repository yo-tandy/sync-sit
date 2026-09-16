import { describe, it, expect } from 'vitest';
import { compareByDistanceLast } from '../haversine.js';

// haversineDistance itself is exercised by packages/sit-core's re-export
// test (packages/sit-core/src/utils/__tests__/haversine.test.ts) against
// this same implementation — this file covers the new LAST-tie-break
// comparator added for issue #439.
describe('compareByDistanceLast', () => {
  it('sorts the nearer value first', () => {
    expect(compareByDistanceLast(1.2, 3.4)).toBeLessThan(0);
    expect(compareByDistanceLast(3.4, 1.2)).toBeGreaterThan(0);
  });

  it('treats equal distances as a tie', () => {
    expect(compareByDistanceLast(2.3, 2.3)).toBe(0);
  });

  it('sorts a null distance after a numeric one, on either side', () => {
    expect(compareByDistanceLast(null, 5)).toBeGreaterThan(0);
    expect(compareByDistanceLast(5, null)).toBeLessThan(0);
  });

  it('sorts an undefined distance after a numeric one, on either side', () => {
    expect(compareByDistanceLast(undefined, 5)).toBeGreaterThan(0);
    expect(compareByDistanceLast(5, undefined)).toBeLessThan(0);
  });

  it('treats two providers with no computable distance as a tie (never excluded)', () => {
    expect(compareByDistanceLast(null, null)).toBe(0);
    expect(compareByDistanceLast(undefined, undefined)).toBe(0);
    expect(compareByDistanceLast(null, undefined)).toBe(0);
  });

  it('sorts an array with mixed values nearer-first, no-distance last', () => {
    const values: Array<number | null> = [5, null, 1, 3, null, 2];
    values.sort(compareByDistanceLast);
    expect(values).toEqual([1, 2, 3, 5, null, null]);
  });

  it('handles a zero distance (same point) without treating it as "no distance"', () => {
    // A falsy-but-valid 0 must sort strictly before a positive distance and
    // before null — a `!a` / `!b` truthiness check would mis-treat this.
    expect(compareByDistanceLast(0, 4)).toBeLessThan(0);
    expect(compareByDistanceLast(0, null)).toBeLessThan(0);
    expect(compareByDistanceLast(0, 0)).toBe(0);
  });
});
