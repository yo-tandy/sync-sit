import { db } from '@ejm/shared-functions/config/firebase.js';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { parisWallClockPosition } from '@ejm/shared-functions/scheduled/parisTime.js';
import { getSchoolYearsInRange, type DayOverride } from '@ejm/study-core';
import type { LocationPref, SlotLocationCells } from '@ejm/study-core';
import {
  computeDateAvailability,
  resolveDateLocationCells,
  sessionToConfirmedBlock,
  type WeeklyGrid,
  type HolidayPeriod,
  type DateAvailabilityInputs,
} from './computeDateAvailability.js';

/**
 * Best-effort single-date availability grid for a tutor+date.
 *
 * Loads this one date's inputs and runs the SHARED per-date composition
 * (computeDateAvailability) — the same one getTutorAvailability and the confirm
 * transaction use — so family AND tutor see, request/propose, and get exactly one
 * picture. Deliberately BEST-EFFORT: pending sessions never block (only confirmed
 * blocks are subtracted); the authoritative claim is the confirm transaction.
 *
 * Extracted from bookSession so BOTH entry points into a pending one_time session
 * — the family's bookSession and the tutor's proposeSession — run byte-identical
 * pre-checks against the SAME tutor schedule. Behavior is unchanged from the
 * original inline function (its book-session pre-check tests are the proof).
 */
export interface SingleDateBookability {
  /** The bookable slot grid (unchanged boolean composition). */
  slots: boolean[];
  /**
   * Per-cell location overrides applicable to this date (issue #166): null
   * cells = profile defaults; all-null on override/holiday-substituted dates
   * (their tags are a follow-up) and on legacy docs.
   */
  locationCells: SlotLocationCells;
}

export async function computeSingleDateAvailability(
  tutorUserId: string,
  date: string,
  paddingMin: number,
): Promise<SingleDateBookability> {
  const scheduleSnap = await db.collection('schedules').doc(tutorUserId).get();
  const schedule = scheduleSnap.data();
  const weekly: WeeklyGrid = (schedule?.weekly as WeeklyGrid) ?? {};
  const holidayMode = schedule?.holidayMode as string | undefined;
  const holidaySchedules = schedule?.holidaySchedules as
    | Record<string, WeeklyGrid>
    | undefined;

  const overrideSnap = await db
    .collection('schedules')
    .doc(tutorUserId)
    .collection('overrides')
    .doc(date)
    .get();
  const overrideData = overrideSnap.data();
  const override: DayOverride | undefined = overrideData
    ? {
        type: overrideData.type as DayOverride['type'],
        slots: overrideData.slots as boolean[] | undefined,
        // Authorship marker — location tag resolution distinguishes a
        // tutor-authored 'manual' override from a session-claim doc.
        reason: overrideData.reason as string | undefined,
      }
    : undefined;

  // Holiday periods for this date's school year (only when holidayMode differs).
  const holidayPeriods: HolidayPeriod[] = [];
  if (holidayMode === 'different') {
    const years = getSchoolYearsInRange(date, date);
    const holidaySnaps = await Promise.all(
      years.map((y) => db.collection('holidays').doc(y).get()),
    );
    for (const snap of holidaySnaps) {
      const p = snap.data()?.periods as HolidayPeriod[] | undefined;
      if (p) holidayPeriods.push(...p);
    }
  }

  // Confirmed sessions on this date → blocks subtracted from the grid.
  // Uses the (tutorUserId, status, date) composite index.
  const sessionsSnap = await db
    .collection('study-sessions')
    .where('tutorUserId', '==', tutorUserId)
    .where('status', '==', 'confirmed')
    .where('date', '==', date)
    .get();
  const confirmedBlocks = sessionsSnap.docs
    .filter((doc) => doc.data().date)
    .map((doc) => {
      const s = doc.data();
      return sessionToConfirmedBlock({
        startTime: s.startTime as string,
        endTime: s.endTime as string,
        location: s.location as LocationPref,
      });
    });

  // Scheduled recurring INSTANCES on this date → also subtracted. On a holiday-
  // schedule date a recurring occurrence's override claim is precedence-invisible
  // (holidayGrid ?? override ?? weekly), so this direct subtraction is the guard
  // that keeps a family from requesting a slot already held by an instance. Only
  // 'scheduled' instances block. Uses the (tutorUserId, status, date) CG index.
  const instancesSnap = await db
    .collectionGroup('instances')
    .where('tutorUserId', '==', tutorUserId)
    .where('status', '==', 'scheduled')
    .where('date', '==', date)
    .get();
  for (const doc of instancesSnap.docs) {
    const s = doc.data();
    confirmedBlocks.push(
      sessionToConfirmedBlock({
        startTime: s.startTime as string,
        endTime: s.endTime as string,
        location: s.location as LocationPref,
      }),
    );
  }

  const inputs: DateAvailabilityInputs = {
    weekly,
    weeklyLocations: schedule?.weeklyLocations,
    holidayMode,
    holidaySchedules,
    holidayPeriods,
    override,
    confirmedBlocks,
    paddingMin,
  };
  return {
    slots: computeDateAvailability(
      date,
      inputs,
      parisWallClockPosition(new Date()),
      (await getConfigValue('bookingNoticeHours')),
    ),
    locationCells: resolveDateLocationCells(date, inputs),
  };
}
