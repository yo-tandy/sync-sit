import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { timeToSlotIndex } from '@ejm/shared-core';
import {
  expandRecurringDates,
  computeDayAvailability,
  dayOfWeek,
  type ConfirmedBlock,
  type DayOverride,
  type ParisNow,
} from '@ejm/study-core';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useHolidays } from '@/hooks/useHolidays';
import { getClientConfigValue } from '@/lib/adminConfigClient';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';
import { Spinner, Badge } from '@ejm/shared-ui';
import type { StudySessionDoc } from '@/types/studySession';

// Code DEFAULTS for the two admin-configurable values the accept flow
// uses (issue #250): the preview must predict exactly what
// respondToSession materializes, so both are read from the same config
// the callable reads, with these as the shared fallback.
const HORIZON_WEEKS = 8;
const NOTICE_HOURS = 24;

type DateStatus = 'available' | 'conflict' | 'holiday';
interface DatePreview {
  date: string;
  status: DateStatus;
}
interface PreviewResult {
  rows: DatePreview[];
  availableCount: number;
}

const STATUS_CLASS: Record<DateStatus, string> = {
  available: 'text-green-700',
  conflict: 'text-brand-600',
  holiday: 'text-gray-500',
};

/** Paris "YYYY-MM-DD" for an instant (DST-correct via the runtime tz database). */
function parisDate(d: Date): string {
  // en-CA renders ISO-ordered YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Current Paris wall-clock position (date + minutes since midnight). */
function parisNow(now: Date): ParisNow {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const [hh, mm] = time.split(':').map(Number);
  return { date: parisDate(now), minutesSinceMidnight: (hh % 24) * 60 + mm };
}

/**
 * Client-side "N of 8 dates available" preview for a pending RECURRING request.
 *
 * Runs the SAME pure math the callable uses (expandRecurringDates +
 * computeDayAvailability from @ejm/study-core) over the tutor's own,
 * rules-readable data: their weekly grid (schedules/{uid}), the per-date
 * override docs, and their confirmed one_time sessions on the candidate dates.
 *
 * DELIBERATELY APPROXIMATE — the callable is authoritative and re-checks
 * everything inside a transaction at accept time:
 *  - Other series' scheduled INSTANCES are NOT subtracted here. The client has
 *    no collection-group rule to read them, and a tutor rarely has overlapping
 *    recurring instances at preview time; a missed one simply shows 'available'
 *    here and is skipped automatically on accept.
 *  - Padding is treated as 0 (the pending session's paddingMinutes is not on the
 *    client doc shape), so a padding-only adjacency conflict may read available.
 *  - Holiday-schedule SUBSTITUTION (holidayMode 'different') is not modelled;
 *    for the common schoolWeeksOnly case holiday dates are shown as skipped
 *    before any grid is computed, which is what actually happens on accept.
 * These only ever make the preview more optimistic than the claim, never less,
 * so the disclaimer ("conflicting dates are skipped automatically") holds.
 */
export function RecurringConflictPreview({ session }: { session: StudySessionDoc }) {
  const { t, i18n } = useTranslation();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;
  const { periods, loading: holidaysLoading } = useHolidays();

  const [result, setResult] = useState<PreviewResult | null>(null);

  useEffect(() => {
    if (!uid || holidaysLoading) return;
    let cancelled = false;

    (async () => {
      const slot = session.recurringSlots?.[0];
      if (!slot) {
        if (!cancelled) setResult({ rows: [], availableCount: 0 });
        return;
      }

      const now = new Date();
      const nowParis = parisNow(now);
      const [horizonWeeks, noticeHours] = await Promise.all([
        getClientConfigValue('recurringHorizonWeeks', HORIZON_WEEKS, ADMIN_CONFIG_DEFS.recurringHorizonWeeks),
        getClientConfigValue('bookingNoticeHours', NOTICE_HOURS, ADMIN_CONFIG_DEFS.bookingNoticeHours),
      ]);
      const fromDate = parisDate(new Date(now.getTime() + noticeHours * 60 * 60 * 1000));
      const schoolWeeksOnly = session.schoolWeeksOnly !== false; // default true

      // Expand ALL weekly occurrences (schoolWeeksOnly=false, no periods) so
      // holiday dates still appear as explicit skip rows rather than vanishing;
      // the holiday classification happens per-row below. endDate truncation is
      // handled inside expandRecurringDates.
      const dates = expandRecurringDates(slot, fromDate, horizonWeeks, session.endDate, false, []);
      if (dates.length === 0) {
        if (!cancelled) setResult({ rows: [], availableCount: 0 });
        return;
      }

      const startIdx = timeToSlotIndex(slot.startTime);
      const endIdx = timeToSlotIndex(slot.endTime);

      try {
        const [scheduleSnap, overrideSnaps, sessionsSnap] = await Promise.all([
          getDoc(doc(db, 'schedules', uid)),
          Promise.all(dates.map((d) => getDoc(doc(db, 'schedules', uid, 'overrides', d)))),
          getDocs(query(collection(db, 'study-sessions'), where('tutorUserId', '==', uid))),
        ]);
        if (cancelled) return;

        const schedule = scheduleSnap.exists() ? scheduleSnap.data() : undefined;
        const weekly = (schedule?.weekly ?? {}) as Record<string, boolean[]>;

        // Confirmed one_time sessions grouped by date — the only conflicts we
        // subtract client-side (see the component note on omitted instances).
        const confirmedByDate = new Map<string, ConfirmedBlock[]>();
        for (const d of sessionsSnap.docs) {
          const s = d.data() as StudySessionDoc;
          if (s.status !== 'confirmed' || s.type !== 'one_time' || !s.date || !s.endTime) continue;
          const arr = confirmedByDate.get(s.date) ?? [];
          arr.push({
            startIdx: timeToSlotIndex(s.startTime),
            endIdx: timeToSlotIndex(s.endTime),
            location: s.location,
          });
          confirmedByDate.set(s.date, arr);
        }

        const inHoliday = (date: string): boolean =>
          periods.some((p) => date >= p.startDate && date <= p.endDate);

        const rows: DatePreview[] = dates.map((date, i) => {
          if (schoolWeeksOnly && inHoliday(date)) return { date, status: 'holiday' };

          const oSnap = overrideSnaps[i];
          const override: DayOverride | null =
            oSnap.exists() && oSnap.data()
              ? { type: oSnap.data()!.type, slots: oSnap.data()!.slots }
              : null;

          const grid = computeDayAvailability({
            date,
            weeklySlots: weekly[dayOfWeek(date)] ?? [],
            override,
            holidayGrid: null,
            confirmedBlocks: confirmedByDate.get(date) ?? [],
            paddingMin: 0,
            nowParis,
            noticeHours,
          });

          let free = true;
          for (let s = startIdx; s < endIdx; s++) {
            if (!grid[s]) {
              free = false;
              break;
            }
          }
          return { date, status: free ? 'available' : 'conflict' };
        });

        setResult({ rows, availableCount: rows.filter((r) => r.status === 'available').length });
      } catch {
        if (!cancelled) setResult({ rows: [], availableCount: 0 });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, holidaysLoading, periods, session]);

  const formatDateStr = (s: string): string => {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return s;
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (holidaysLoading || result === null) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <Spinner className="h-3 w-3" />
        {t('tutor.sessions.preview.loading')}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-2">
      <p className="text-xs font-semibold text-gray-700">
        {t('tutor.sessions.preview.summary', {
          available: result.availableCount,
          total: result.rows.length,
        })}
      </p>
      {result.rows.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {(() => {
            // The trial lands on the first date that actually materializes — i.e.
            // the first 'available' row (the same date the confirm schedules first).
            const trialDate = session.trialFirstSession
              ? result.rows.find((r) => r.status === 'available')?.date
              : undefined;
            return result.rows.map((r) => (
              <li key={r.date} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{formatDateStr(r.date)}</span>
                <span className="flex items-center gap-1.5">
                  {r.date === trialDate && (
                    <Badge variant="blue">{t('tutor.sessions.trial.badge')}</Badge>
                  )}
                  <span className={STATUS_CLASS[r.status]}>
                    {t(`tutor.sessions.preview.status.${r.status}`)}
                  </span>
                </span>
              </li>
            ));
          })()}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] leading-tight text-gray-500">
        {t('tutor.sessions.preview.disclaimer')}
      </p>
    </div>
  );
}
