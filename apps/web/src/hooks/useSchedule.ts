import { useState, useEffect, useCallback } from 'react';
import {
  doc,
  collection,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { createEmptySlots, DAYS_OF_WEEK } from '@ejm/shared';
import type { ScheduleDoc, ScheduleOverrideDoc } from '@ejm/shared';
import type { DayOfWeek, HolidayMode } from '@ejm/shared';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

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
    async (weekly: Record<DayOfWeek, boolean[]>) => {
      if (!uid) return;
      const scheduleRef = doc(db, 'schedules', uid);
      await setDoc(
        scheduleRef,
        {
          userId: uid,
          weekly,
          holidayMode: schedule?.holidayMode || 'same',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
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
