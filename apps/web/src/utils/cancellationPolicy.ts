import type { TFunction } from 'i18next';

/**
 * Cancellation-policy display helper (issue #237) — the sit twin of
 * study-web's utils/cancellationPolicy.ts, deliberately identical: the 1-week
 * preset (168) renders as the translated "1 week", every other preset as
 * "{n}h". The server flag (`lateCancellation`) is authoritative; this is
 * display only.
 */
export function humanizeNoticeWindow(hours: number, t: TFunction): string {
  if (hours >= 168) return t('search.window.week');
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

/** True when the appointment's start wall-time is already past (Paris clock). */
export function hasStarted(date: string, startTime: string, now: Date = new Date()): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = startTime.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return false;
  const p = parisParts(now);
  return wallMs(y, m, d, hh, mm) < wallMs(p.y, p.m, p.day, p.hh, p.mm);
}

/**
 * APPROXIMATE client-side lateness for the cancel-flow warning (study's
 * helper, byte-identical logic): true when the appointment start is inside
 * the notice window right now. The server flag is authoritative -- and the
 * server additionally never flags an appointment that already started (sit
 * has no completed sweep), so this warning simply isn't shown for past
 * appointments by the caller.
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
