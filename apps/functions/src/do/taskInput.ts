import { HttpsError } from 'firebase-functions/v2/https';
import {
  validateTaskTiming,
  validateTaskTimingNotPast,
  type TaskCadence,
  type TaskTiming,
} from '@ejm/do-core';

/**
 * Timing-group extraction shared by doPostTask and doUpdateTask (§4.1: the
 * when-group is discriminated by `timing`, exactly one group non-null; the
 * callable normalizes omitted fields to explicit stored nulls — JSON has no
 * `undefined`, so a web form posting a `fixed` task naturally omits the
 * other groups' fields).
 */

export interface StoredTimingFields {
  timing: TaskTiming;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  dueDate: string | null;
  startDate: string | null;
  endDate: string | null;
  cadence: TaskCadence | null;
}

/**
 * Validate the payload's timing group (shape via do-core, already-past via
 * `validateTaskTimingNotPast` — the publishSearch "date is already past"
 * guard at the same layer) and return the normalized stored shape.
 * Throws `invalid-argument` in the house style.
 */
export function extractTimingFields(
  data: Record<string, unknown>,
  now: Date,
): StoredTimingFields {
  const timingErr = validateTaskTiming(data);
  if (timingErr) throw new HttpsError('invalid-argument', timingErr);
  const fields: StoredTimingFields = {
    timing: data.timing as TaskTiming,
    date: (data.date as string | undefined) ?? null,
    startTime: (data.startTime as string | undefined) ?? null,
    endTime: (data.endTime as string | undefined) ?? null,
    dueDate: (data.dueDate as string | undefined) ?? null,
    startDate: (data.startDate as string | undefined) ?? null,
    endDate: (data.endDate as string | undefined) ?? null,
    cadence: sanitizeCadence(data.cadence as TaskCadence | null | undefined),
  };
  const pastErr = validateTaskTimingNotPast(fields, now);
  if (pastErr) throw new HttpsError('invalid-argument', pastErr);
  return fields;
}

/**
 * Rebuild the cadence with EXACTLY the schema's keys (validated upstream by
 * validateTaskCadence inside validateTaskTiming): a raw client object could
 * smuggle arbitrary extra keys into the stored doc, and `undefined` values
 * would make Firestore reject the write. Optional keys are stored as
 * explicit nulls (`days` empty for daily/custom without days).
 */
export function sanitizeCadence(
  cadence: TaskCadence | null | undefined,
): TaskCadence | null {
  if (cadence === null || cadence === undefined) return null;
  return {
    kind: cadence.kind,
    days: cadence.days ?? [],
    timeHint: cadence.timeHint ?? null,
    note: cadence.note ?? null,
  };
}
