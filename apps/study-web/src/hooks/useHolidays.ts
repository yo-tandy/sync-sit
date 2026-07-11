import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { HolidayPeriod } from '@ejm/shared-core';

// Copied from apps/web/src/hooks/useHolidays.ts. Adaptation: HolidayPeriod is
// imported from @ejm/shared-core (where the type lives) rather than @ejm/sit-core.
// Reads the shared school-holiday calendar at holidays/{schoolYear}.

function getCurrentSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, 8 = September
  if (month >= 8) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

export function useHolidays() {
  const [periods, setPeriods] = useState<HolidayPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const schoolYear = getCurrentSchoolYear();
    const holidayRef = doc(db, 'holidays', schoolYear);

    const unsub = onSnapshot(
      holidayRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setPeriods(data.periods || []);
        } else {
          setPeriods([]);
        }
        setLoading(false);
      },
      () => {
        // Error (e.g. no permissions) — just return empty
        setPeriods([]);
        setLoading(false);
      }
    );

    return unsub;
  }, []);

  return { periods, loading, schoolYear: getCurrentSchoolYear() };
}
