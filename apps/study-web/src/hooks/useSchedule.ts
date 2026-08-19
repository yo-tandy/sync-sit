import { useState, useEffect, useCallback } from 'react';
import {
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { createEmptySlots, DAYS_OF_WEEK } from '@ejm/shared-core';
import type { ScheduleDoc, ScheduleOverrideDoc } from '@ejm/shared-core';
import type { DayOfWeek, HolidayMode } from '@ejm/shared-core';

// Copied from apps/web/src/hooks/useSchedule.ts. The only adaptation is the
// type/constant source: sync-sit imports these from @ejm/sit-core, but the
// schedule primitives actually live in @ejm/shared-core (which study-web
// already depends on and which DashboardPage reads from), so we import from
// there directly — no need to route through sit-core.
//
// The schedule lives at schedules/{uid}. It exists for every tutor (created
// during enrollment). ACCEPTED RISK: schedules are keyed on uid alone, so a
// person who is both a babysitter and a tutor shares ONE availability grid
// across both apps. This is a known limitation of the portable-user schema
// for dual-profile users and is tracked as a follow-up.

function createDefaultSchedule(): ScheduleDoc['weekly'] {
  const weekly = {} as Record<DayOfWeek, boolean[]>;
  for (const day of DAYS_OF_WEEK) {
    weekly[day] = createEmptySlots();
  }
  return weekly;
}

export function useSchedule() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [schedule, setSchedule] = useState<ScheduleDoc | null>(null);
  const [overrides, setOverrides] = useState<ScheduleOverrideDoc[]>([]);
  // Initial loading state derives from uid: if there is no signed-in user
  // we have nothing to fetch, so we are already "done" loading. The
  // schedule snapshot callback below flips this back to false once
  // Firestore has returned the first result for a valid uid.
  const [loading, setLoading] = useState<boolean>(Boolean(uid));

  useEffect(() => {
    if (!uid) return;

    const scheduleRef = doc(db, 'schedules', uid);
    const overridesRef = collection(db, 'schedules', uid, 'overrides');

    const unsubSchedule = onSnapshot(scheduleRef, (snap) => {
      if (snap.exists()) {
        setSchedule(snap.data() as ScheduleDoc);
      } else {
        // No schedule yet — use defaults
        setSchedule(null);
      }
      setLoading(false);
    });

    const unsubOverrides = onSnapshot(overridesRef, (snap) => {
      const items = snap.docs.map((d) => ({
        ...d.data(),
        date: d.id,
      })) as ScheduleOverrideDoc[];
      setOverrides(items.sort((a, b) => a.date.localeCompare(b.date)));
    });

    return () => {
      unsubSchedule();
      unsubOverrides();
    };
  }, [uid]);

  const saveWeekly = useCallback(
    async (
      weekly: Record<DayOfWeek, boolean[]>,
      weeklyLocations?: ScheduleDoc['weeklyLocations'],
      holiday?: {
        mode: HolidayMode;
        holidaySchedules?: Record<string, Record<DayOfWeek, boolean[]>>;
        holidayNotes?: string;
      },
    ) => {
      if (!uid) return;
      const scheduleRef = doc(db, 'schedules', uid);
      // ONE atomic batch: the grid set-merge, the tags update, and (when the
      // caller passes it) the holiday fields commit — and fail — together.
      // SchedulePage's save previously issued the holiday write as a second
      // await, so a rejection there left the grid+tags persisted while the
      // page reported "the save did not go through" (PR #185 review). The
      // update mutation is still needed for the tags — a set-merge would
      // DEEP-MERGE the nested day maps and resurrect stale per-cell keys,
      // while update() replaces the whole weeklyLocations field. Batch
      // writes apply in order, so the update's exists-precondition is
      // satisfied by the set before it (the doc also always exists for a
      // tutor — created during enrollment).
      const data: Record<string, unknown> = {
        userId: uid,
        weekly,
        holidayMode: holiday?.mode ?? (schedule?.holidayMode || 'same'),
        updatedAt: serverTimestamp(),
      };
      if (holiday && holiday.mode === 'different' && holiday.holidaySchedules) {
        data.holidaySchedules = holiday.holidaySchedules;
      }
      if (holiday && holiday.holidayNotes !== undefined) {
        data.holidayNotes = holiday.holidayNotes;
      }
      const batch = writeBatch(db);
      batch.set(scheduleRef, data, { merge: true });
      if (weeklyLocations !== undefined) {
        batch.update(scheduleRef, { weeklyLocations });
      }
      await batch.commit();
    },
    [uid, schedule?.holidayMode]
  );

  const setHolidayMode = useCallback(
    async (
      mode: HolidayMode,
      holidaySchedules?: Record<string, Record<DayOfWeek, boolean[]>>,
      holidayNotes?: string
    ) => {
      if (!uid) return;
      const scheduleRef = doc(db, 'schedules', uid);
      const data: Record<string, unknown> = {
        holidayMode: mode,
        updatedAt: serverTimestamp(),
      };
      if (mode === 'different' && holidaySchedules) {
        data.holidaySchedules = holidaySchedules;
      }
      if (holidayNotes !== undefined) {
        data.holidayNotes = holidayNotes;
      }
      await setDoc(scheduleRef, data, { merge: true });
    },
    [uid]
  );

  const addOverride = useCallback(
    async (date: string, type: 'unavailable' | 'custom', slots?: boolean[]) => {
      if (!uid) return;
      const overrideRef = doc(db, 'schedules', uid, 'overrides', date);
      const data: Record<string, unknown> = {
        date,
        type,
        reason: 'manual',
        createdAt: serverTimestamp(),
      };
      if (type === 'custom' && slots) {
        data.slots = slots;
      }
      await setDoc(overrideRef, data);
    },
    [uid]
  );

  const removeOverride = useCallback(
    async (date: string) => {
      if (!uid) return;
      await deleteDoc(doc(db, 'schedules', uid, 'overrides', date));
    },
    [uid]
  );

  const weekly = schedule?.weekly || createDefaultSchedule();

  return {
    weekly,
    weeklyLocations: schedule?.weeklyLocations, // raw; sanitize at the consumer
    holidayMode: schedule?.holidayMode || ('same' as HolidayMode),
    holidayWeekly: schedule?.holidayWeekly, // deprecated
    holidaySchedules: schedule?.holidaySchedules,
    holidayNotes: schedule?.holidayNotes,
    overrides,
    loading,
    saveWeekly,
    setHolidayMode,
    addOverride,
    removeOverride,
  };
}
