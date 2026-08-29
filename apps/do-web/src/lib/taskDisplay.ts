import type { TFunction } from 'i18next';
import type { TaskTiming } from '@ejm/do-core';

/** The when-group fields a card/review line needs (a TaskDoc or the wizard
 * draft — both carry them under the same names, §4.1). */
export interface TimingLike {
  timing: TaskTiming;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * One-line timing summary for task cards, the wizard review and the detail
 * header. Dates stay ISO (YYYY-MM-DD) like the sibling apps' compact rows —
 * locale-pretty formatting is a shared-ui concern the suite has not taken
 * on yet.
 */
export function formatTimingSummary(t: TFunction, f: TimingLike): string {
  switch (f.timing) {
    case 'fixed':
      return t('timing.summary.fixed', {
        date: f.date ?? '',
        startTime: f.startTime ?? '',
        endTime: f.endTime ?? '',
      });
    case 'deadline':
      return t('timing.summary.deadline', { dueDate: f.dueDate ?? '' });
    case 'recurring':
      return t('timing.summary.recurring', {
        startDate: f.startDate ?? '',
        endDate: f.endDate ?? '',
      });
    case 'ongoing':
      return t('timing.summary.ongoing', { startDate: f.startDate ?? '' });
  }
}

/** Millis of a Firestore Timestamp-ish value; 0 when absent/malformed. */
export function tsMillis(value: unknown): number {
  const v = value as { toMillis?: () => number; toDate?: () => Date } | null | undefined;
  if (v?.toMillis) return v.toMillis();
  if (v?.toDate) return v.toDate().getTime();
  return 0;
}
