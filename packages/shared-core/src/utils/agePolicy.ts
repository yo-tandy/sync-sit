const PARIS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parisYmd(d: Date): { y: number; m: number; day: number } {
  const parts = PARIS_FMT.formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g('year'), m: g('month'), day: g('day') };
}

/**
 * The calendar year in which the CURRENT school year ends. September boundary,
 * Paris wall clock — matches getValidGraduationYears' convention.
 */
export function schoolYearEnd(now: Date): number {
  const { y, m } = parisYmd(now);
  return m >= 9 ? y + 1 : y;
}

/**
 * Expected age today for a student whose EJM email carries the given 2-digit
 * graduation year: 18 in terminale, one less per school year remaining.
 */
export function expectedAgeForGradYear(twoDigitGradYear: number, now: Date): number {
  const fullGradYear = 2000 + twoDigitGradYear;
  return 18 - (fullGradYear - schoolYearEnd(now));
}

export type AgeGateVerdict = 'ok' | 'under_15' | 'age_mismatch';

/** Full years elapsed between dob and now (calendar-accurate, Paris). */
export function ageFromDob(dateOfBirth: Date, now: Date = new Date()): number {
  const n = parisYmd(now);
  const b = {
    y: dateOfBirth.getUTCFullYear(),
    m: dateOfBirth.getUTCMonth() + 1,
    day: dateOfBirth.getUTCDate(),
  };
  let age = n.y - b.y;
  if (n.m < b.m || (n.m === b.m && n.day < b.day)) age -= 1;
  return age;
}

/**
 * Self-enrollment age gate (governance design §"Age policy"). The under-15
 * floor is checked FIRST and is never waivable; the ±1-class consistency check
 * is admin-exemptable at the call sites.
 */
export function checkEnrollmentAge(opts: {
  dateOfBirth: Date;
  graduationYear: number;
  now?: Date;
}): AgeGateVerdict {
  const now = opts.now ?? new Date();
  const age = ageFromDob(opts.dateOfBirth, now);
  if (age < 15) return 'under_15';
  const expected = expectedAgeForGradYear(opts.graduationYear, now);
  if (Math.abs(age - expected) > 1) return 'age_mismatch';
  return 'ok';
}
