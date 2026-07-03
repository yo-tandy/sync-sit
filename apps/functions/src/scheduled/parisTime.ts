/**
 * Appointment `date` and `startTime` strings are wall-clock times in
 * Europe/Paris: the web app writes and displays them as-is for its
 * Paris-based users. Cloud Functions run in UTC (and dev machines run
 * in whatever the local zone is), so parsing them with
 * `new Date('YYYY-MM-DDTHH:mm:ss')` — which uses the server-local zone —
 * shifts them by the server's offset from Paris. These helpers pin the
 * interpretation to Europe/Paris regardless of server timezone.
 */

const PARIS_TZ = 'Europe/Paris';

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parisClock(instant: Date): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** YYYY-MM-DD calendar date of the given instant, as seen in Paris. */
export function parisDateString(instant: Date): string {
  const c = parisClock(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

/**
 * Converts a Paris wall-clock date ('YYYY-MM-DD') + time ('HH:mm') to
 * the UTC instant it denotes.
 */
export function parisWallTimeToUtc(date: string, time: string): Date {
  const wallAsUtcMs = new Date(`${date}T${time}:00Z`).getTime();
  // Guess the instant by pretending the wall time is UTC, then correct
  // by the Paris offset. The second iteration handles guesses that land
  // on the wrong side of a DST transition.
  let instant = new Date(wallAsUtcMs);
  for (let i = 0; i < 2; i++) {
    const c = parisClock(instant);
    const seenWallAsUtcMs = Date.UTC(
      c.year,
      c.month - 1,
      c.day,
      c.hour,
      c.minute,
      c.second,
    );
    const offsetMs = seenWallAsUtcMs - instant.getTime();
    instant = new Date(wallAsUtcMs - offsetMs);
  }
  return instant;
}
