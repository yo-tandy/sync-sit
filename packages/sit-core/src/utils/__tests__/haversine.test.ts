import { describe, it, expect } from 'vitest';
import { haversineDistance } from '../haversine.js';

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    const point = { lat: 48.8566, lng: 2.3522 };
    expect(haversineDistance(point, point)).toBe(0);
  });

  it('calculates Eiffel Tower to Notre Dame (~4.1km)', () => {
    const eiffelTower = { lat: 48.8584, lng: 2.2945 };
    const notreDame = { lat: 48.8530, lng: 2.3499 };
    const distance = haversineDistance(eiffelTower, notreDame);
    expect(distance).toBeGreaterThan(3.5);
    expect(distance).toBeLessThan(4.5);
  });

  it('calculates Paris to London (~340km)', () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const london = { lat: 51.5074, lng: -0.1278 };
    const distance = haversineDistance(paris, london);
    expect(distance).toBeGreaterThan(330);
    expect(distance).toBeLessThan(350);
  });

  it('is symmetric', () => {
    const a = { lat: 48.8566, lng: 2.3522 };
    const b = { lat: 51.5074, lng: -0.1278 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 10);
  });
});
