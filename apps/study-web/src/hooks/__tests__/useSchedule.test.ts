import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createEmptySlots, DAYS_OF_WEEK } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';

// Per-slot location tags (issue #166, PR #185 review): the weekly grid and the
// weeklyLocations map must persist ATOMICALLY — one writeBatch whose set(merge)
// carries the grid and whose update() REPLACES the whole weeklyLocations field
// (a set-merge would deep-merge the nested day maps and resurrect stale
// per-cell keys). A transient rejection must fail the whole save, never
// persist the grid while silently dropping the tags.
const h = vi.hoisted(() => {
  const batch = {
    set: vi.fn(),
    update: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  };
  return {
    batch,
    writeBatch: vi.fn(() => batch),
    setDoc: vi.fn(() => Promise.resolve()),
    onSnapshot: vi.fn(() => () => {}),
  };
});

vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel: (s: { firebaseUser: { uid: string } }) => unknown) =>
    sel({ firebaseUser: { uid: 't1' } }),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
  setDoc: (...args: unknown[]) => h.setDoc(...args),
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => 'ts',
  writeBatch: (...args: unknown[]) => h.writeBatch(...args),
}));

import { useSchedule } from '../useSchedule';

function emptyWeekly() {
  return Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, createEmptySlots()]),
  ) as Record<DayOfWeek, boolean[]>;
}

beforeEach(() => {
  h.batch.set.mockClear();
  h.batch.update.mockClear();
  h.batch.commit.mockClear().mockImplementation(() => Promise.resolve());
  h.writeBatch.mockClear();
  h.setDoc.mockClear();
});

describe('useSchedule.saveWeekly', () => {
  it('persists grid and tags in ONE batch: set(merge) + whole-field update', async () => {
    const { result } = renderHook(() => useSchedule());
    const weekly = emptyWeekly();
    const weeklyLocations = { mon: { '64': ['online'] } };
    await result.current.saveWeekly(weekly, weeklyLocations);

    expect(h.writeBatch).toHaveBeenCalledTimes(1);
    expect(h.batch.set).toHaveBeenCalledWith(
      { path: 'schedules/t1' },
      { userId: 't1', weekly, holidayMode: 'same', updatedAt: 'ts' },
      { merge: true },
    );
    expect(h.batch.update).toHaveBeenCalledWith(
      { path: 'schedules/t1' },
      { weeklyLocations },
    );
    expect(h.batch.commit).toHaveBeenCalledTimes(1);
    // Nothing rides outside the batch.
    expect(h.setDoc).not.toHaveBeenCalled();
  });

  it('omits the tags update when weeklyLocations is not passed', async () => {
    const { result } = renderHook(() => useSchedule());
    await result.current.saveWeekly(emptyWeekly());
    expect(h.batch.set).toHaveBeenCalledTimes(1);
    expect(h.batch.update).not.toHaveBeenCalled();
    expect(h.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('propagates a commit rejection to the caller (no silent partial)', async () => {
    h.batch.commit.mockImplementation(() => Promise.reject(new Error('offline')));
    const { result } = renderHook(() => useSchedule());
    await expect(
      result.current.saveWeekly(emptyWeekly(), { mon: { '64': ['online'] } }),
    ).rejects.toThrow('offline');
  });
});
