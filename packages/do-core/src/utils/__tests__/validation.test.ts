import { describe, it, expect } from 'vitest';
import {
  isCalendarDate,
  isClockTime,
  validateAvailabilityNote,
  validateEstimatedHours,
  validateOfferHelper,
  validateOfferMessage,
  validatePrice,
  validatePriceBasis,
  validateSuggestedBudget,
  validateTaskCadence,
  validateTaskDescription,
  validateTaskPhotos,
  validateTaskTiming,
  validateTaskTimingNotPast,
  validateTaskTitle,
  type TaskTimingFields,
} from '../validation.js';
import {
  DO_AVAILABILITY_NOTE_MAX,
  DO_CADENCE_NOTE_MAX,
  DO_CADENCE_TIME_HINT_MAX,
  DO_OFFER_MESSAGE_MAX,
  DO_PRICE_MAX,
  DO_PRICE_MIN,
  DO_TASK_DESCRIPTION_MAX,
  DO_TASK_PHOTOS_MAX,
  DO_TASK_TITLE_MAX,
} from '../../constants/index.js';

// ── Valid fixtures per timing model (§4.1: exactly one group non-null) ──

const FIXED: TaskTimingFields = {
  timing: 'fixed',
  date: '2026-09-12',
  startTime: '14:00',
  endTime: '18:00',
  dueDate: null,
  startDate: null,
  endDate: null,
  cadence: null,
};

const DEADLINE: TaskTimingFields = {
  timing: 'deadline',
  date: null,
  startTime: null,
  endTime: null,
  dueDate: '2026-09-30',
  startDate: null,
  endDate: null,
  cadence: null,
};

const RECURRING: TaskTimingFields = {
  timing: 'recurring',
  date: null,
  startTime: null,
  endTime: null,
  dueDate: null,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  cadence: { kind: 'weekly', days: ['mon', 'thu'], timeHint: 'around 18:00' },
};

const ONGOING: TaskTimingFields = {
  timing: 'ongoing',
  date: null,
  startTime: null,
  endTime: null,
  dueDate: null,
  startDate: '2026-09-01',
  endDate: null,
  cadence: { kind: 'custom', note: 'whenever the bins go out' },
};

describe('validateTaskTiming — the discriminant (§4.1)', () => {
  it('accepts a well-formed task in each of the four models', () => {
    expect(validateTaskTiming(FIXED)).toBeNull();
    expect(validateTaskTiming(DEADLINE)).toBeNull();
    expect(validateTaskTiming(RECURRING)).toBeNull();
    expect(validateTaskTiming(ONGOING)).toBeNull();
  });

  it('rejects an unknown timing', () => {
    expect(
      validateTaskTiming({ ...FIXED, timing: 'sometime' as 'fixed' }),
    ).not.toBeNull();
  });

  it('rejects a second non-null group on every model (cross-contamination)', () => {
    // fixed with a deadline field
    expect(validateTaskTiming({ ...FIXED, dueDate: '2026-09-30' })).not.toBeNull();
    // fixed with a recurring field
    expect(validateTaskTiming({ ...FIXED, startDate: '2026-09-12' })).not.toBeNull();
    expect(
      validateTaskTiming({ ...FIXED, cadence: { kind: 'daily' } }),
    ).not.toBeNull();
    // deadline with fixed fields
    expect(validateTaskTiming({ ...DEADLINE, date: '2026-09-30' })).not.toBeNull();
    expect(validateTaskTiming({ ...DEADLINE, startTime: '10:00' })).not.toBeNull();
    // deadline with an ongoing field
    expect(validateTaskTiming({ ...DEADLINE, startDate: '2026-10-01' })).not.toBeNull();
    // recurring with fixed/deadline fields
    expect(validateTaskTiming({ ...RECURRING, date: '2026-10-01' })).not.toBeNull();
    expect(validateTaskTiming({ ...RECURRING, dueDate: '2026-10-31' })).not.toBeNull();
    // ongoing with endDate ("endDate: recurring (null for ongoing)")
    expect(validateTaskTiming({ ...ONGOING, endDate: '2026-12-31' })).not.toBeNull();
    expect(validateTaskTiming({ ...ONGOING, dueDate: '2026-12-31' })).not.toBeNull();
  });

  it('rejects a missing required field on every model', () => {
    expect(validateTaskTiming({ ...FIXED, date: null })).not.toBeNull();
    expect(validateTaskTiming({ ...FIXED, startTime: null })).not.toBeNull();
    expect(validateTaskTiming({ ...FIXED, endTime: null })).not.toBeNull();
    expect(validateTaskTiming({ ...DEADLINE, dueDate: null })).not.toBeNull();
    expect(validateTaskTiming({ ...RECURRING, startDate: null })).not.toBeNull();
    expect(validateTaskTiming({ ...RECURRING, endDate: null })).not.toBeNull();
    expect(validateTaskTiming({ ...RECURRING, cadence: null })).not.toBeNull();
    expect(validateTaskTiming({ ...ONGOING, startDate: null })).not.toBeNull();
    expect(validateTaskTiming({ ...ONGOING, cadence: null })).not.toBeNull();
  });

  it('bounds dates to the calendar and times to the clock (junk shapes)', () => {
    expect(validateTaskTiming({ ...FIXED, date: '2026-13-45' })).not.toBeNull();
    expect(validateTaskTiming({ ...FIXED, startTime: '25:99' })).not.toBeNull();
    expect(
      validateTaskTiming({ ...DEADLINE, dueDate: '2026-02-30' }),
    ).not.toBeNull();
    expect(
      validateTaskTiming({ ...RECURRING, startDate: 'next monday' }),
    ).not.toBeNull();
  });

  it('rejects a recurring range that ends before it starts', () => {
    expect(
      validateTaskTiming({
        ...RECURRING,
        startDate: '2026-10-31',
        endDate: '2026-10-01',
      }),
    ).not.toBeNull();
  });

  it('treats OMITTED fields as absent, equivalently to explicit null (callable JSON drops undefined)', () => {
    // A web form posting a fixed task naturally omits the other groups'
    // fields rather than null-filling all seven.
    expect(
      validateTaskTiming({
        timing: 'fixed',
        date: '2026-09-12',
        startTime: '14:00',
        endTime: '18:00',
      }),
    ).toBeNull();
    expect(
      validateTaskTiming({ timing: 'deadline', dueDate: '2026-09-30' }),
    ).toBeNull();
    expect(
      validateTaskTiming({
        timing: 'ongoing',
        startDate: '2026-09-01',
        cadence: { kind: 'daily' },
      }),
    ).toBeNull();
    // ...and a required field that is omitted fails as "need", not as a
    // TypeError or a "must not set".
    expect(
      validateTaskTiming({ timing: 'fixed', date: '2026-09-12' }),
    ).toMatch(/need startTime/);
    expect(validateTaskTiming({ timing: 'deadline' })).toMatch(/need dueDate/);
  });

  it('type-guards every field itself: junk reaches the error message, never a TypeError', () => {
    // A non-string startTime must come back invalid-argument-shaped, not
    // throw from inside isClockTime.
    expect(validateTaskTiming({ ...FIXED, startTime: 1400 })).toMatch(
      /startTime/,
    );
    expect(validateTaskTiming({ ...FIXED, date: 20260912 })).toMatch(/date/);
    expect(
      validateTaskTiming({ ...RECURRING, endDate: ['2026-10-31'] }),
    ).toMatch(/endDate/);
    expect(validateTaskTiming({ ...DEADLINE, dueDate: {} })).toMatch(/dueDate/);
    // Non-object inputs are errors, not throws.
    expect(validateTaskTiming(null)).not.toBeNull();
    expect(validateTaskTiming(undefined)).not.toBeNull();
    expect(validateTaskTiming('fixed')).not.toBeNull();
  });

  it('accepts a fixed task crossing midnight (endTime <= startTime — the publishSearch precedent)', () => {
    expect(
      validateTaskTiming({ ...FIXED, startTime: '20:00', endTime: '01:00' }),
    ).toBeNull();
    expect(
      validateTaskTiming({ ...FIXED, startTime: '22:00', endTime: '22:00' }),
    ).toBeNull();
  });
});

describe('validateTaskCadence', () => {
  it('accepts daily, weekly-with-days, and custom-with-note', () => {
    expect(validateTaskCadence({ kind: 'daily' })).toBeNull();
    expect(validateTaskCadence({ kind: 'weekly', days: ['sat'] })).toBeNull();
    expect(validateTaskCadence({ kind: 'custom', note: 'as needed' })).toBeNull();
  });

  it('rejects weekly without days, custom without note, junk day keys', () => {
    expect(validateTaskCadence({ kind: 'weekly' })).not.toBeNull();
    expect(validateTaskCadence({ kind: 'weekly', days: [] })).not.toBeNull();
    expect(validateTaskCadence({ kind: 'custom' })).not.toBeNull();
    expect(validateTaskCadence({ kind: 'custom', note: '  ' })).not.toBeNull();
    expect(
      validateTaskCadence({ kind: 'weekly', days: ['monday'] }),
    ).not.toBeNull();
    expect(
      validateTaskCadence({ kind: 'weekly', days: ['mon', 'mon'] }),
    ).not.toBeNull();
    expect(validateTaskCadence({ kind: 'never' })).not.toBeNull();
    expect(validateTaskCadence(null)).not.toBeNull();
  });

  it('bounds note and timeHint lengths (round-2: every free-text field has a ceiling)', () => {
    expect(
      validateTaskCadence({ kind: 'custom', note: 'x'.repeat(DO_CADENCE_NOTE_MAX) }),
    ).toBeNull();
    expect(
      validateTaskCadence({
        kind: 'custom',
        note: 'x'.repeat(DO_CADENCE_NOTE_MAX + 1),
      }),
    ).toMatch(/note/);
    expect(
      validateTaskCadence({
        kind: 'daily',
        timeHint: 'x'.repeat(DO_CADENCE_TIME_HINT_MAX),
      }),
    ).toBeNull();
    expect(
      validateTaskCadence({
        kind: 'daily',
        timeHint: 'x'.repeat(DO_CADENCE_TIME_HINT_MAX + 1),
      }),
    ).toMatch(/timeHint/);
    // the ceiling also applies to an optional note on a non-custom cadence
    expect(
      validateTaskCadence({
        kind: 'weekly',
        days: ['mon'],
        note: 'x'.repeat(DO_CADENCE_NOTE_MAX + 1),
      }),
    ).toMatch(/note/);
  });
});

describe('validateAvailabilityNote (§4.2)', () => {
  it('allows null and bounded strings, rejects oversize and non-strings', () => {
    expect(validateAvailabilityNote(null)).toBeNull();
    expect(validateAvailabilityNote('weekends work best')).toBeNull();
    expect(
      validateAvailabilityNote('x'.repeat(DO_AVAILABILITY_NOTE_MAX)),
    ).toBeNull();
    expect(
      validateAvailabilityNote('x'.repeat(DO_AVAILABILITY_NOTE_MAX + 1)),
    ).not.toBeNull();
    expect(validateAvailabilityNote(42)).not.toBeNull();
    expect(validateAvailabilityNote(undefined)).not.toBeNull();
  });
});

describe('length bounds (§4.1, §4.2)', () => {
  it('title: ≤ 80, required', () => {
    expect(validateTaskTitle('Water my plants')).toBeNull();
    expect(validateTaskTitle('x'.repeat(DO_TASK_TITLE_MAX))).toBeNull();
    expect(validateTaskTitle('x'.repeat(DO_TASK_TITLE_MAX + 1))).not.toBeNull();
    expect(validateTaskTitle('')).not.toBeNull();
    expect(validateTaskTitle('   ')).not.toBeNull();
    expect(validateTaskTitle(42)).not.toBeNull();
  });

  it('description: ≤ 2000, required', () => {
    expect(validateTaskDescription('Two ficus, one fussy orchid.')).toBeNull();
    expect(
      validateTaskDescription('x'.repeat(DO_TASK_DESCRIPTION_MAX)),
    ).toBeNull();
    expect(
      validateTaskDescription('x'.repeat(DO_TASK_DESCRIPTION_MAX + 1)),
    ).not.toBeNull();
    expect(validateTaskDescription('')).not.toBeNull();
  });

  it('offer message: ≤ 1000, required', () => {
    expect(validateOfferMessage('Done IKEA before')).toBeNull();
    expect(validateOfferMessage('x'.repeat(DO_OFFER_MESSAGE_MAX))).toBeNull();
    expect(
      validateOfferMessage('x'.repeat(DO_OFFER_MESSAGE_MAX + 1)),
    ).not.toBeNull();
    expect(validateOfferMessage('')).not.toBeNull();
  });

  it('photos: ≤ 6 {uid, photoId} pairs', () => {
    const photo = (n: number) => ({ uid: 'u1', photoId: `p${n}` });
    expect(validateTaskPhotos([])).toBeNull();
    expect(
      validateTaskPhotos(
        Array.from({ length: DO_TASK_PHOTOS_MAX }, (_, i) => photo(i)),
      ),
    ).toBeNull();
    expect(
      validateTaskPhotos(
        Array.from({ length: DO_TASK_PHOTOS_MAX + 1 }, (_, i) => photo(i)),
      ),
    ).not.toBeNull();
    expect(validateTaskPhotos([{ photoId: 'p1' }])).not.toBeNull();
    expect(validateTaskPhotos([{ uid: 'u1' }])).not.toBeNull();
    expect(validateTaskPhotos([{ uid: '', photoId: 'p1' }])).not.toBeNull();
    expect(validateTaskPhotos(['p1'])).not.toBeNull();
    expect(validateTaskPhotos('p1')).not.toBeNull();
  });

  it('photos: both halves are structurally bounded — no path smuggling (round 2)', () => {
    // doGetTaskPhotoUrl signs `do-photos/{uid}/{photoId}` from the stored
    // pair via the Admin SDK (bypassing storage.rules), so neither half may
    // carry separators or traversal.
    const ok = {
      uid: 'AbC123xyz',
      photoId: '550e8400-e29b-41d4-a716-446655440000',
    };
    expect(validateTaskPhotos([ok])).toBeNull();
    // photoId: safe charset only
    expect(
      validateTaskPhotos([{ uid: ok.uid, photoId: 'a/b' }]),
    ).toMatch(/photoId/);
    expect(
      validateTaskPhotos([{ uid: ok.uid, photoId: '..' }]),
    ).toMatch(/photoId/);
    expect(
      validateTaskPhotos([{ uid: ok.uid, photoId: 'p 1' }]),
    ).toMatch(/photoId/);
    expect(
      validateTaskPhotos([{ uid: ok.uid, photoId: 'a'.repeat(129) }]),
    ).toMatch(/photoId/);
    // uid: no separators, traversal, control chars, or oversize
    expect(
      validateTaskPhotos([{ uid: 'u/1', photoId: ok.photoId }]),
    ).toMatch(/uid/);
    expect(
      validateTaskPhotos([{ uid: '..', photoId: ok.photoId }]),
    ).toMatch(/uid/);
    expect(
      validateTaskPhotos([{ uid: 'u\n1', photoId: ok.photoId }]),
    ).toMatch(/uid/);
    expect(
      validateTaskPhotos([{ uid: 'a'.repeat(129), photoId: ok.photoId }]),
    ).toMatch(/uid/);
  });
});

describe('validateTaskTimingNotPast (round 2 — the publishSearch already-past guard)', () => {
  // 2026-09-12T20:00:00Z == 22:00 Paris (CEST) that evening.
  const EVENING = new Date('2026-09-12T20:00:00Z');

  it('refuses a dated task whose window is already over', () => {
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'fixed',
          date: '2026-09-10',
          startTime: '14:00',
          endTime: '18:00',
          dueDate: null,
          startDate: null,
        },
        EVENING,
      ),
    ).toMatch(/past/);
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'deadline',
          date: null,
          startTime: null,
          endTime: null,
          dueDate: '2026-09-11',
          startDate: null,
        },
        EVENING,
      ),
    ).toMatch(/past/);
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'recurring',
          date: null,
          startTime: null,
          endTime: null,
          dueDate: null,
          startDate: '2026-09-01',
        },
        EVENING,
      ),
    ).toMatch(/past/);
  });

  it('passes future dates, and a same-day task while its day still runs', () => {
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'fixed',
          date: '2026-09-20',
          startTime: '14:00',
          endTime: '18:00',
          dueDate: null,
          startDate: null,
        },
        EVENING,
      ),
    ).toBeNull();
    // §6.3: a dated task lives until the END of its day — at 22:00 Paris the
    // 12th is not past yet, even for an afternoon slot.
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'fixed',
          date: '2026-09-12',
          startTime: '14:00',
          endTime: '18:00',
          dueDate: null,
          startDate: null,
        },
        EVENING,
      ),
    ).toBeNull();
  });

  it('midnight-crossing interaction: 20:00–01:00 posted at 22:00 the same evening is still valid', () => {
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'fixed',
          date: '2026-09-12',
          startTime: '20:00',
          endTime: '01:00',
          dueDate: null,
          startDate: null,
        },
        EVENING,
      ),
    ).toBeNull();
    // ...and even posted the NEXT morning it holds until the end of the day
    // it ends on; two days later it is past.
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'fixed',
          date: '2026-09-12',
          startTime: '20:00',
          endTime: '01:00',
          dueDate: null,
          startDate: null,
        },
        new Date('2026-09-14T08:00:00Z'),
      ),
    ).toMatch(/past/);
  });

  it('ongoing is never past (expiry is now + TTL by construction)', () => {
    expect(
      validateTaskTimingNotPast(
        {
          timing: 'ongoing',
          date: null,
          startTime: null,
          endTime: null,
          dueDate: null,
          startDate: '2020-01-01',
        },
        EVENING,
      ),
    ).toBeNull();
  });
});

describe('price bounds (EUR)', () => {
  it('accepts the range edges and rejects outside them', () => {
    expect(validatePrice(DO_PRICE_MIN)).toBeNull();
    expect(validatePrice(40)).toBeNull();
    expect(validatePrice(37.5)).toBeNull();
    expect(validatePrice(DO_PRICE_MAX)).toBeNull();
    expect(validatePrice(DO_PRICE_MIN - 1)).not.toBeNull();
    expect(validatePrice(DO_PRICE_MAX + 1)).not.toBeNull();
    expect(validatePrice(NaN)).not.toBeNull();
    expect(validatePrice(Infinity)).not.toBeNull();
    expect(validatePrice('40')).not.toBeNull();
    expect(validatePrice(null)).not.toBeNull();
  });

  it('suggestedBudget additionally allows null (the offer sets the price)', () => {
    expect(validateSuggestedBudget(null)).toBeNull();
    expect(validateSuggestedBudget(60)).toBeNull();
    expect(validateSuggestedBudget(DO_PRICE_MAX + 1)).not.toBeNull();
    expect(validateSuggestedBudget('60')).not.toBeNull();
  });

  it('priceBasis is flat or hourly', () => {
    expect(validatePriceBasis('flat')).toBeNull();
    expect(validatePriceBasis('hourly')).toBeNull();
    expect(validatePriceBasis('daily')).not.toBeNull();
    expect(validatePriceBasis(undefined)).not.toBeNull();
  });
});

describe('offer helper (decision 9) and estimatedHours', () => {
  it('helper: null, or a complete {firstName, lastName, age}', () => {
    expect(validateOfferHelper(null)).toBeNull();
    expect(
      validateOfferHelper({ firstName: 'Léa', lastName: 'Martin', age: 16 }),
    ).toBeNull();
    expect(
      validateOfferHelper({ firstName: '', lastName: 'Martin', age: 16 }),
    ).not.toBeNull();
    expect(
      validateOfferHelper({ firstName: 'Léa', lastName: 'Martin', age: 16.5 }),
    ).not.toBeNull();
    expect(
      validateOfferHelper({ firstName: 'Léa', lastName: 'Martin' }),
    ).not.toBeNull();
    expect(validateOfferHelper('Léa')).not.toBeNull();
  });

  it('estimatedHours: null or a positive number', () => {
    expect(validateEstimatedHours(null)).toBeNull();
    expect(validateEstimatedHours(2.5)).toBeNull();
    expect(validateEstimatedHours(0)).not.toBeNull();
    expect(validateEstimatedHours(-1)).not.toBeNull();
    expect(validateEstimatedHours('2')).not.toBeNull();
  });
});

describe('date/time primitives', () => {
  it('isCalendarDate round-trips through the calendar', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true); // leap year
    expect(isCalendarDate('2026-02-29')).toBe(false); // not a leap year
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('26-01-01')).toBe(false);
  });

  it('isClockTime bounds to the clock', () => {
    expect(isClockTime('00:00')).toBe(true);
    expect(isClockTime('23:59')).toBe(true);
    expect(isClockTime('24:00')).toBe(false);
    expect(isClockTime('12:60')).toBe(false);
    expect(isClockTime('9:00')).toBe(false);
  });
});
