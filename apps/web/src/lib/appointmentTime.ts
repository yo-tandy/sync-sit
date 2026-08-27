/**
 * Paris wall-clock helpers for the appointment-note edit windows (issue #238,
 * parity B2 — study duplicates these per SessionsPage; sit shares them).
 *
 * UX-only mirrors of the callable's gate: setAppointmentNote re-checks with
 * the DST-correct parisWallTimeToUtc server-side. Comparing "YYYY-MM-DDTHH:MM"
 * strings in Paris wall-clock is exact for this purpose — both sides of the
 * comparison live in the same (wall-clock) frame.
 */
export function parisNowStamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Has the given Paris wall-clock start (date + HH:MM) already passed? The
 * family's pre-note window closes — and the babysitter's post-note window
 * opens — once this is true. Missing date/startTime (a recurring appointment)
 * returns false: recurring windows are handled by the caller, not by time. */
export function hasStarted(date?: string, startTime?: string): boolean {
  if (!date || !startTime) return false;
  return `${date}T${startTime}` <= parisNowStamp();
}
