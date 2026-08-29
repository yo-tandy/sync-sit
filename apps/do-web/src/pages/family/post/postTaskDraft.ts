import {
  validateSuggestedBudget,
  validateTaskDescription,
  validateTaskTiming,
  validateTaskTimingNotPast,
  validateTaskTitle,
  type AdultPresence,
  type TaskCadence,
  type TaskCategory,
  type TaskTiming,
} from '@ejm/do-core';

/**
 * The post-a-task wizard's draft model (plan §9.1 bullet 1) — pure module so
 * the step-gating and payload assembly are unit-testable without rendering.
 * Validation runs the SAME do-core validators doPostTask runs server-side
 * (§8: "the wizard pre-empts every error").
 */

/** §9.1's step order, verbatim. */
export const POST_STEPS = [
  'category',
  'subCategory',
  'timing',
  'describe',
  'photos',
  'adultPresent',
  'toolsTransport',
  'budget',
  'review',
] as const;
export type PostStep = (typeof POST_STEPS)[number];

export type PhotoState = 'uploading' | 'processing' | 'ready' | 'error';
export interface PhotoItem {
  photoId: string;
  state: PhotoState;
  /** Signed thumbnail URL once the stripper republished (doGetOwnPhotoUrl). */
  url: string | null;
}

export interface TaskDraft {
  category: TaskCategory | null;
  subCategory: string | null;

  timing: TaskTiming | null;
  date: string;
  startTime: string;
  endTime: string;
  dueDate: string;
  startDate: string;
  endDate: string;
  cadenceKind: TaskCadence['kind'];
  cadenceDays: NonNullable<TaskCadence['days']>;
  cadenceTimeHint: string;
  cadenceNote: string;
  estimatedHours: string;

  title: string;
  description: string;
  photos: PhotoItem[];

  adultPresent: AdultPresence | null;
  /** §5.7: pet_house feeding/drop-in require an explicit alone-at-home
   *  acknowledgement when adultPresent is 'no'. */
  aloneAck: boolean;

  toolsProvided: boolean | null;
  transportNeeded: boolean;
  suggestedBudget: string;
}

export const EMPTY_DRAFT: TaskDraft = {
  category: null,
  subCategory: null,
  timing: null,
  date: '',
  startTime: '',
  endTime: '',
  dueDate: '',
  startDate: '',
  endDate: '',
  cadenceKind: 'weekly',
  cadenceDays: [],
  cadenceTimeHint: '',
  cadenceNote: '',
  estimatedHours: '',
  title: '',
  description: '',
  photos: [],
  adultPresent: null,
  aloneAck: false,
  toolsProvided: null,
  transportNeeded: false,
  suggestedBudget: '',
};

/** §5.7's two alone-in-an-empty-home sub-categories (content-level UX: the
 * posting form requires an explicit `adultPresent: 'no'` acknowledgement for
 * exactly these, rather than nudging toward 'yes'). */
export const ALONE_HOME_SUBCATEGORIES = ['pet_house_feeding', 'pet_house_drop_in'];

/** The timing group as the callable expects it: the selected model's fields
 * only, everything else omitted (the callable normalizes omissions to stored
 * nulls — §4.1, taskInput.ts). */
export function buildTimingFields(d: TaskDraft): Record<string, unknown> {
  switch (d.timing) {
    case 'fixed':
      return { timing: 'fixed', date: d.date, startTime: d.startTime, endTime: d.endTime };
    case 'deadline':
      return { timing: 'deadline', dueDate: d.dueDate };
    case 'recurring':
    case 'ongoing': {
      const cadence: TaskCadence = {
        kind: d.cadenceKind,
        ...(d.cadenceKind === 'weekly' ? { days: d.cadenceDays } : {}),
        ...(d.cadenceTimeHint.trim() ? { timeHint: d.cadenceTimeHint.trim() } : {}),
        ...(d.cadenceKind === 'custom' ? { note: d.cadenceNote.trim() } : {}),
      };
      return d.timing === 'recurring'
        ? { timing: 'recurring', startDate: d.startDate, endDate: d.endDate, cadence }
        : { timing: 'ongoing', startDate: d.startDate, cadence };
    }
    default:
      return { timing: null };
  }
}

export function parsedBudget(d: TaskDraft): number | null {
  return d.suggestedBudget.trim() === '' ? null : Number(d.suggestedBudget);
}

export function parsedEstimatedHours(d: TaskDraft): number | null {
  return d.estimatedHours.trim() === '' ? null : Number(d.estimatedHours);
}

/**
 * May the wizard advance past `step`? Runs the do-core validators (so the
 * gates match doPostTask exactly) plus the §5.7 acknowledgement rule the
 * server cannot see (it is a UX declaration, not schema).
 */
export function isStepValid(step: PostStep, d: TaskDraft, now: Date = new Date()): boolean {
  switch (step) {
    case 'category':
      return d.category !== null;
    case 'subCategory':
      return d.subCategory !== null;
    case 'timing': {
      if (d.timing === null) return false;
      const fields = buildTimingFields(d);
      if (validateTaskTiming(fields) !== null) return false;
      if (
        validateTaskTimingNotPast(
          // validateTaskTiming just proved the group's shape; the expiry
          // computation reads the same fields.
          fields as unknown as Parameters<typeof validateTaskTimingNotPast>[0],
          now,
        ) !== null
      ) {
        return false;
      }
      const hours = parsedEstimatedHours(d);
      return hours === null || (Number.isFinite(hours) && hours > 0);
    }
    case 'describe':
      return validateTaskTitle(d.title) === null && validateTaskDescription(d.description) === null;
    case 'photos':
      // Optional, but nothing may still be in flight: a publish racing the
      // stripper is exactly the photo_not_ready round trip §7.4 pre-empts.
      return d.photos.every((p) => p.state === 'ready');
    case 'adultPresent':
      if (d.adultPresent === null) return false;
      if (
        d.adultPresent === 'no' &&
        d.subCategory !== null &&
        ALONE_HOME_SUBCATEGORIES.includes(d.subCategory)
      ) {
        return d.aloneAck;
      }
      return true;
    case 'toolsTransport':
      return true;
    case 'budget':
      return validateSuggestedBudget(parsedBudget(d)) === null;
    case 'review':
      return true;
  }
}

/** The doPostTask payload (§4.1 fields the client owns; the server derives
 * familyId/areaLabel/expiresAt itself). `uid` is the uploader — each photo
 * ships as the full `{uid, photoId}` pair §4.1 stores, and doPostTask
 * asserts every pair lives under the CALLER'S own prefix (§7.4). */
export function buildPostTaskPayload(d: TaskDraft, uid: string): Record<string, unknown> {
  return {
    category: d.category,
    subCategory: d.subCategory,
    title: d.title.trim(),
    description: d.description.trim(),
    photos: d.photos.filter((p) => p.state === 'ready').map((p) => ({ uid, photoId: p.photoId })),
    ...buildTimingFields(d),
    estimatedHours: parsedEstimatedHours(d),
    suggestedBudget: parsedBudget(d),
    adultPresent: d.adultPresent,
    toolsProvided: d.toolsProvided,
    transportNeeded: d.transportNeeded,
  };
}
