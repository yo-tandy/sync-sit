// ── Phone plausibility ──
//
// One rule for every free-text contact-phone field (client gates and server
// guards alike), so a number the form accepts is never rejected by the
// callable. Deliberately loose — this is a typo/garbage guard, not E.164
// parsing: an optional leading '+', then only digits, spaces and the usual
// separators ( ) . -, with at least 6 digits in total.
const PHONE_SHAPE = /^\+?[0-9 ().-]+$/;
const PHONE_MIN_DIGITS = 6;

export function isPlausiblePhone(value: string): boolean {
  const v = value.trim();
  return PHONE_SHAPE.test(v) && v.replace(/\D/g, '').length >= PHONE_MIN_DIGITS;
}
