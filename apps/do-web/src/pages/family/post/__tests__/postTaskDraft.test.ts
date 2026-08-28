import { describe, it, expect } from 'vitest';
import {
  ALONE_HOME_SUBCATEGORIES,
  EMPTY_DRAFT,
  POST_STEPS,
  buildPostTaskPayload,
  buildTimingFields,
  isStepValid,
  type TaskDraft,
} from '../postTaskDraft';

/** Draft-model pins: §9.1's step order, do-core-matched gating, and the
 * exact payload/timing-group shapes doPostTask expects. */

const NOW = new Date('2026-08-28T12:00:00Z');

function draft(overrides: Partial<TaskDraft>): TaskDraft {
  return { ...EMPTY_DRAFT, ...overrides };
}

const validFixed: Partial<TaskDraft> = {
  timing: 'fixed',
  date: '2026-09-10',
  startTime: '14:00',
  endTime: '16:00',
};

describe('POST_STEPS', () => {
  it("pins §9.1's wizard order verbatim", () => {
    expect(POST_STEPS).toEqual([
      'category',
      'subCategory',
      'timing',
      'describe',
      'photos',
      'adultPresent',
      'toolsTransport',
      'budget',
      'review',
    ]);
  });
});

describe('buildTimingFields', () => {
  it('ships ONLY the selected model group (others omitted, not null-filled)', () => {
    expect(buildTimingFields(draft(validFixed))).toEqual({
      timing: 'fixed',
      date: '2026-09-10',
      startTime: '14:00',
      endTime: '16:00',
    });
    expect(buildTimingFields(draft({ timing: 'deadline', dueDate: '2026-09-15' }))).toEqual({
      timing: 'deadline',
      dueDate: '2026-09-15',
    });
  });

  it('assembles the cadence for recurring/ongoing with exactly the schema keys', () => {
    const recurring = buildTimingFields(
      draft({
        timing: 'recurring',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        cadenceKind: 'weekly',
        cadenceDays: ['mon', 'thu'],
        cadenceTimeHint: 'around 18:00',
      }),
    );
    expect(recurring).toEqual({
      timing: 'recurring',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      cadence: { kind: 'weekly', days: ['mon', 'thu'], timeHint: 'around 18:00' },
    });

    const ongoing = buildTimingFields(
      draft({ timing: 'ongoing', startDate: '2026-09-01', cadenceKind: 'custom', cadenceNote: 'when it rains' }),
    );
    expect(ongoing).toEqual({
      timing: 'ongoing',
      startDate: '2026-09-01',
      cadence: { kind: 'custom', note: 'when it rains' },
    });
  });
});

describe('isStepValid', () => {
  it('gates category/subCategory on a selection', () => {
    expect(isStepValid('category', EMPTY_DRAFT)).toBe(false);
    expect(isStepValid('category', draft({ category: 'ikea' }))).toBe(true);
    expect(isStepValid('subCategory', draft({ category: 'ikea' }))).toBe(false);
    expect(isStepValid('subCategory', draft({ category: 'ikea', subCategory: 'ikea_assembly' }))).toBe(true);
  });

  it('gates timing through validateTaskTiming AND the not-past check', () => {
    expect(isStepValid('timing', EMPTY_DRAFT, NOW)).toBe(false);
    expect(isStepValid('timing', draft(validFixed), NOW)).toBe(true);
    // Shape-valid but already past — the publishSearch "date is already
    // past" guard, client-side.
    expect(isStepValid('timing', draft({ ...validFixed, date: '2026-08-01' }), NOW)).toBe(false);
    // Weekly cadence without days fails do-core's cadence validator.
    expect(
      isStepValid(
        'timing',
        draft({ timing: 'recurring', startDate: '2026-09-01', endDate: '2026-09-30', cadenceKind: 'weekly', cadenceDays: [] }),
        NOW,
      ),
    ).toBe(false);
  });

  it('gates describe on the do-core title/description bounds', () => {
    const base = { title: 'Assemble PAX', description: 'Two wardrobes, tools on site.' };
    expect(isStepValid('describe', draft(base))).toBe(true);
    expect(isStepValid('describe', draft({ ...base, title: '' }))).toBe(false);
    expect(isStepValid('describe', draft({ ...base, title: 'x'.repeat(81) }))).toBe(false);
    expect(isStepValid('describe', draft({ ...base, description: 'x'.repeat(2001) }))).toBe(false);
  });

  it('blocks the photos step while any upload is still in flight', () => {
    expect(isStepValid('photos', draft({ photos: [] }))).toBe(true);
    expect(
      isStepValid('photos', draft({ photos: [{ photoId: 'a', state: 'ready', url: 'u' }] })),
    ).toBe(true);
    for (const state of ['uploading', 'processing', 'error'] as const) {
      expect(
        isStepValid('photos', draft({ photos: [{ photoId: 'a', state, url: null }] })),
      ).toBe(false);
    }
  });

  it("requires the §5.7 alone-at-home acknowledgement for pet feeding/drop-in with adultPresent 'no'", () => {
    expect(ALONE_HOME_SUBCATEGORIES).toEqual(['pet_house_feeding', 'pet_house_drop_in']);
    for (const sub of ALONE_HOME_SUBCATEGORIES) {
      const noAck = draft({ category: 'pet_house', subCategory: sub, adultPresent: 'no' });
      expect(isStepValid('adultPresent', noAck)).toBe(false);
      expect(isStepValid('adultPresent', { ...noAck, aloneAck: true })).toBe(true);
      // 'yes' needs no acknowledgement.
      expect(isStepValid('adultPresent', { ...noAck, adultPresent: 'yes' })).toBe(true);
    }
    // Other sub-categories never require it.
    expect(
      isStepValid('adultPresent', draft({ category: 'ikea', subCategory: 'ikea_assembly', adultPresent: 'no' })),
    ).toBe(true);
  });

  it('gates budget on the shared price bounds, empty allowed', () => {
    expect(isStepValid('budget', draft({ suggestedBudget: '' }))).toBe(true);
    expect(isStepValid('budget', draft({ suggestedBudget: '50' }))).toBe(true);
    expect(isStepValid('budget', draft({ suggestedBudget: '-1' }))).toBe(false);
    expect(isStepValid('budget', draft({ suggestedBudget: '1001' }))).toBe(false);
    expect(isStepValid('budget', draft({ suggestedBudget: 'abc' }))).toBe(false);
  });
});

describe('buildPostTaskPayload', () => {
  it('ships the §4.1 client-owned fields, photos as {uid, photoId} pairs, READY photos only', () => {
    const d = draft({
      ...validFixed,
      category: 'ikea',
      subCategory: 'ikea_assembly',
      title: '  Assemble PAX  ',
      description: ' Two wardrobes. ',
      photos: [
        { photoId: 'ph-1', state: 'ready', url: 'u1' },
        { photoId: 'ph-2', state: 'processing', url: null },
      ],
      adultPresent: 'yes',
      toolsProvided: true,
      transportNeeded: false,
      suggestedBudget: '60',
      estimatedHours: '3',
    });
    expect(buildPostTaskPayload(d, 'uid-1')).toEqual({
      category: 'ikea',
      subCategory: 'ikea_assembly',
      title: 'Assemble PAX',
      description: 'Two wardrobes.',
      photos: [{ uid: 'uid-1', photoId: 'ph-1' }],
      timing: 'fixed',
      date: '2026-09-10',
      startTime: '14:00',
      endTime: '16:00',
      estimatedHours: 3,
      suggestedBudget: 60,
      adultPresent: 'yes',
      toolsProvided: true,
      transportNeeded: false,
    });
  });
});
