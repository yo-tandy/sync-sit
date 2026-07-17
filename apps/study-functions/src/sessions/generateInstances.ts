import type { Transaction, DocumentReference } from 'firebase-admin/firestore';
import { timeToSlotIndex } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import { dayOfWeek, type DayOverride, type ConfirmedBlock, type ParisNow } from '@ejm/study-core';
import {
  computeDateAvailability,
  type WeeklyGrid,
  type HolidayPeriod,
} from '../availability/computeDateAvailability.js';
import { paddedBlock, buildMergedOverride } from './sessionOverride.js';

/** Notice window: an occurrence cannot be scheduled within this many hours of "now". */
const NOTICE_HOURS = 24;

/** Pre-loaded, transactionally-read claim state for one candidate date. */
export interface PerDateClaimInputs {
  /** The per-date override doc parsed to a DayOverride (for availability math). */
  override: DayOverride | null;
  /** The raw override doc data (for restorable-ledger merge preservation). */
  existingOverride: Record<string, unknown> | null;
  /** Confirmed one_time sessions on this date, as blocks. */
  confirmedBlocks: ConfirmedBlock[];
  /** OTHER recurring series' `scheduled` instances on this date, as blocks. */
  cgInstanceBlocks: ConfirmedBlock[];
}

/** The parent series fields an instance denormalizes / a claim needs. */
export interface ParentSessionFacts {
  sessionId: string;
  familyId: string;
  tutorUserId: string;
  subject: string;
  level: string;
  rate: number;
  location: LocationPref;
  sessionLengthMinutes: number;
  paddingMinutes: number;
  startTime: string; // the weekly slot start ("HH:MM")
  endTime: string; // the weekly slot end ("HH:MM")
}

export interface StaticAvailabilityConfig {
  weekly: WeeklyGrid;
  holidayMode?: string;
  holidaySchedules?: Record<string, WeeklyGrid>;
  holidayPeriods: HolidayPeriod[];
}

export interface GenerateInstancesParams {
  tx: Transaction;
  /** Parent series doc ref — instances are written under its `instances` subcollection. */
  sessionRef: DocumentReference;
  /** The tutor's `schedules/{uid}` ref — overrides are written under its `overrides` subcollection. */
  scheduleRef: DocumentReference;
  parent: ParentSessionFacts;
  /** Candidate occurrence dates (already holiday-dropped when schoolWeeksOnly). */
  candidateDates: string[];
  /** Transactionally-read per-date claim state, keyed by date. */
  perDate: Map<string, PerDateClaimInputs>;
  config: StaticAvailabilityConfig;
  nowParis: ParisNow;
  now: Date;
}

export interface GenerateInstancesResult {
  scheduledDates: string[];
  skippedDates: string[];
}

/**
 * The heart of the recurring confirm: turn candidate dates into concrete
 * instances, claiming the tutor's slots on the ones that are still free.
 *
 * For each candidate date (holiday-dropped dates are NOT here — they never
 * produce an instance):
 *   • bookable → create instance {id=date, status 'scheduled', parent denorms}
 *     AND merge the tutor's per-date override with an instanceId-keyed ledger
 *     entry (restorable claim).
 *   • not bookable (an override, a confirmed one_time, or another recurring
 *     series' instance took the slot — or the notice window) → create instance
 *     {id=date, status 'cancelled', statusReason 'conflict_skip'} and write NO
 *     override. A visible gap, not a silent absence.
 *
 * PURE WRITES over pre-loaded reads: every Firestore read the claim depends on
 * (overrides, confirmed sessions, cross-series instances) is passed in via
 * `perDate`, so the caller can satisfy Firestore's reads-before-writes rule.
 * Returns the scheduled/skipped split for the confirm's precondition + emails.
 */
export function generateInstances(params: GenerateInstancesParams): GenerateInstancesResult {
  const { tx, sessionRef, scheduleRef, parent, candidateDates, perDate, config, nowParis, now } = params;

  const startIdx = timeToSlotIndex(parent.startTime);
  const endIdx = timeToSlotIndex(parent.endTime);

  const scheduledDates: string[] = [];
  const skippedDates: string[] = [];

  // Denorms copied onto every instance regardless of status.
  const baseInstance = {
    sessionId: parent.sessionId,
    familyId: parent.familyId,
    tutorUserId: parent.tutorUserId,
    startTime: parent.startTime,
    endTime: parent.endTime,
    sessionLengthMinutes: parent.sessionLengthMinutes,
    paddingMinutes: parent.paddingMinutes,
    subject: parent.subject,
    level: parent.level,
    rate: parent.rate,
    location: parent.location,
  };

  for (const date of candidateDates) {
    const inputs = perDate.get(date) ?? {
      override: null,
      existingOverride: null,
      confirmedBlocks: [],
      cgInstanceBlocks: [],
    };
    const instanceRef = sessionRef.collection('instances').doc(date);

    // Availability against the CURRENT per-date state — the SAME shared
    // composition as book-time and the range view. Confirmed one_time sessions
    // AND other series' scheduled instances are both subtracted; the notice
    // window zeroes slots too close to now.
    const grid = computeDateAvailability(
      date,
      {
        weekly: config.weekly,
        holidayMode: config.holidayMode,
        holidaySchedules: config.holidaySchedules,
        holidayPeriods: config.holidayPeriods,
        override: inputs.override,
        confirmedBlocks: [...inputs.confirmedBlocks, ...inputs.cgInstanceBlocks],
        paddingMin: parent.paddingMinutes,
      },
      nowParis,
      NOTICE_HOURS,
    );

    let available = true;
    for (let i = startIdx; i < endIdx; i++) {
      if (!grid[i]) { available = false; break; }
    }

    if (available) {
      tx.set(instanceRef, {
        ...baseInstance,
        instanceId: date,
        date,
        status: 'scheduled',
        createdAt: now,
        updatedAt: now,
      });

      // Claim the slot in the restorable override ledger (instanceId-keyed).
      const dow = dayOfWeek(date);
      const weeklySlots = config.weekly[dow] ?? [];
      const block = paddedBlock(parent.startTime, parent.endTime, parent.location, parent.paddingMinutes);
      const overrideRef = scheduleRef.collection('overrides').doc(date);
      const merged = buildMergedOverride({
        existing: inputs.existingOverride,
        date,
        weeklySlots,
        block,
        entry: { sessionId: parent.sessionId, instanceId: date, startIdx: block.start, endIdx: block.end },
        now,
      });
      tx.set(overrideRef, merged);

      scheduledDates.push(date);
    } else {
      tx.set(instanceRef, {
        ...baseInstance,
        instanceId: date,
        date,
        status: 'cancelled',
        statusReason: 'conflict_skip',
        cancelledAt: now,
        createdAt: now,
        updatedAt: now,
      });
      skippedDates.push(date);
    }
  }

  return { scheduledDates, skippedDates };
}
