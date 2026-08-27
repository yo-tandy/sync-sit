import { describe, it, expect, vi } from 'vitest';

/**
 * Import the REAL router module (nothing else in the suite does -- the one
 * other consumer mocks it wholesale), so an undefined identifier or broken
 * route table in router.tsx fails a test instead of only the production
 * build (PR #260 round 1: lint cannot catch it -- no-undef is off for TS).
 */
vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }));

import { router } from '@/router';

describe('router module', () => {
  it('builds the route table', () => {
    expect(router).toBeTruthy();
    expect(Array.isArray(router.routes)).toBe(true);
    expect(router.routes.length).toBeGreaterThan(0);
  });
});
