import type { TFunction } from 'i18next';

/**
 * Cancellation-policy display + client-side lateness helpers (V2 feature 7).
 *
 * The tutor's cancellation-notice policy is snapshotted (in hours) onto each
 * session at request time. These helpers are UI-only: they humanize the window
 * for display and pre-compute an APPROXIMATE lateness so the cancel flow can warn
 * before submitting. The server flag (`lateCancellation`) is authoritative.
 */

/**
 * Humanize a notice window (hours) for display: the 1-week preset (168) renders
 * as the translated "1 week"; every other preset renders as "{n}h".
 */
export function humanizeNoticeWindow(hours: number, t: TFunction): string {
  if (hours >= 168) return t('sessions.window.week');
  return `${hours}h`;
}

/** Paris wall-clock parts of an instant (never the running env's local tz). */
function parisParts(d: Date): { y: number; m: number; day: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: g('year'), m: g('month'), day: g('day'), hh: g('hour'), mm: g('minute') };
}

/** Milliseconds for a wall-clock date/time in the RUNNING env's tz (offset cancels). */
function wallMs(y: number, m: number, day: number, hh: number, mm: number): number {
  return new Date(y, m - 1, day, hh, mm).getTime();
}

/**
 * Approximate client-side lateness pre-check for the cancel warning. Both the
 * session's Paris wall-clock start and Paris "now" are constructed in the running
 * environment's timezone, so its offset cancels — only DST shifts inside the
 * window introduce (acceptable) drift. Strict `<`: cancelling exactly at the
 * cutoff is on-time. noticeHours <= 0 → never late. The server flag is the source
 * of truth; this only decides whether to surface a heads-up.
 */
export function isLateCancellationClient(
  date: string,
  startTime: string,
  noticeHours: number,
  now: Date = new Date(),
): boolean {
  if (!noticeHours || noticeHours <= 0) return false;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = startTime.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return false;
  const startMs = wallMs(y, m, d, hh, mm);
  const p = parisParts(now);
  const nowMs = wallMs(p.y, p.m, p.day, p.hh, p.mm);
  return startMs < nowMs + noticeHours * 60 * 60 * 1000;
}
