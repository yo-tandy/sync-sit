/**
 * Legacy Plan C membership resolution (PR #345 round 3).
 *
 * `hasFamilyMembership` (shared-core `userAdapter`) deliberately accepts a
 * family pointer in EITHER place: the Plan D `profiles.parent.familyId`, or the
 * legacy Plan C ROOT-level `familyId`. This hook read only the first, so a Plan
 * C parent got a subscription that was never opened — no error, `loading` false
 * from the start, both buckets permanently `[]` — and every consumer rendered
 * an empty state to a family that may have live appointments. The family
 * dashboard's new empty state made that worse than the summary card it
 * replaced, which at least linked to /family/appointments.
 *
 * Kept apart from `useFamilyAppointments.behavior.test.ts`: that file is an
 * L3 oracle-diff gate with a documented frame contract, and this asks a
 * different question — which field the query was built from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

type MockUserDoc = {
  familyId?: string;
  profiles: { parent: { enrollmentComplete: boolean; familyId?: string } };
};

const { authState, queryState } = vi.hoisted(() => ({
  authState: { userDoc: null as MockUserDoc | null },
  queryState: {
    wheres: [] as { field: string; op: string; val: unknown }[],
    subscribed: 0,
    onError: null as null | ((e: unknown) => void),
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T>(selector: (s: typeof authState) => T) => selector(authState),
}));
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
  doc: (_db: unknown, ...path: string[]) => ({ __doc: path.join('/') }),
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  query: (c: unknown, ...rest: unknown[]) => ({ __query: { c, rest } }),
  where: (field: string, op: string, val: unknown) => {
    queryState.wheres.push({ field, op, val });
    return { __where: { field, op, val } };
  },
  onSnapshot: (_q: unknown, _cb: unknown, onError?: (e: unknown) => void) => {
    queryState.subscribed += 1;
    queryState.onError = onError ?? null;
    return () => {};
  },
}));

import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';

beforeEach(() => {
  queryState.wheres = [];
  queryState.subscribed = 0;
  queryState.onError = null;
  authState.userDoc = null;
});

describe('useFamilyAppointments — legacy Plan C membership', () => {
  it('subscribes on the ROOT familyId when the parent profile carries none', async () => {
    authState.userDoc = {
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true } },
    };
    const { result } = renderHook(() => useFamilyAppointments());

    await waitFor(() => expect(queryState.subscribed).toBe(1));
    expect(queryState.wheres).toContainEqual({
      field: 'familyId',
      op: '==',
      val: 'fam-legacy',
    });
    // And it reports itself as loading, not as an answered-and-empty family.
    expect(result.current.loading).toBe(true);
  });

  it('prefers the Plan D profile pointer when both are present', async () => {
    authState.userDoc = {
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true, familyId: 'fam-current' } },
    };
    renderHook(() => useFamilyAppointments());

    await waitFor(() => expect(queryState.subscribed).toBe(1));
    expect(queryState.wheres).toContainEqual({
      field: 'familyId',
      op: '==',
      val: 'fam-current',
    });
    expect(queryState.wheres).not.toContainEqual({
      field: 'familyId',
      op: '==',
      val: 'fam-legacy',
    });
  });

  it('a subscription error stops claiming to load, and says so', async () => {
    // The fallback makes this hook subscribe where it previously did not, so
    // an erroring subscription is newly reachable — PERMISSION_DENIED for a
    // root familyId whose family does not list this uid, say. With no error
    // callback `bucket` never runs, `loading` stays true, and the family
    // dashboard shows its skeletons forever with no way out (PR #345 round 4).
    authState.userDoc = {
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true } },
    };
    const { result } = renderHook(() => useFamilyAppointments());
    await waitFor(() => expect(queryState.onError).toBeTruthy());

    expect(result.current.loading).toBe(true);
    expect(result.current.loadError).toBe(false);

    act(() => queryState.onError!(new Error('permission-denied')));

    expect(result.current.loading).toBe(false);
    expect(result.current.loadError).toBe(true);
    // A failed read is UNKNOWN, not empty — the buckets are untouched.
    expect(result.current.pending).toEqual([]);
    expect(result.current.confirmed).toEqual([]);
  });

  it('still opens nothing, and is not loading, for a doc with no pointer at all', () => {
    authState.userDoc = { profiles: { parent: { enrollmentComplete: true } } };
    const { result } = renderHook(() => useFamilyAppointments());

    expect(queryState.subscribed).toBe(0);
    // Genuinely nothing to fetch — the empty state here is honest.
    expect(result.current.loading).toBe(false);
  });
});
