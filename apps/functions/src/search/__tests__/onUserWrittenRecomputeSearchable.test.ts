import { describe, it, expect, vi, beforeEach } from 'vitest';

// The trigger registration is mocked to hand back the raw handler (same
// pattern as guardian/__tests__/mirrorEmailApp.test.ts's onDocumentCreated
// mock) — everything below it is the REAL computeEffectiveSearchable
// (shared-core), so a change to that fold-in logic fails these tests too
// rather than drifting apart from what's actually deployed.
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

import { onUserWrittenRecomputeSearchable } from '../onUserWrittenRecomputeSearchable.js';

/** Builds a fake onDocumentWritten event with a spy-able `after.ref.update`. */
function makeEvent(afterData: Record<string, unknown> | undefined) {
  const update = vi.fn().mockResolvedValue(undefined);
  const event = {
    data:
      afterData === undefined
        ? undefined
        : {
            after: {
              data: () => afterData,
              ref: { update },
            },
          },
    params: { uid: 'u1' },
  };
  return { event, update };
}

type Handler = (event: unknown) => Promise<void>;
const handler = onUserWrittenRecomputeSearchable as unknown as Handler;

describe('onUserWrittenRecomputeSearchable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doc deleted (after has no data): no update, no throw', async () => {
    const { event, update } = makeEvent(undefined);
    await expect(handler(event)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('no babysitter/tutor profile at all (e.g. a parent-only doc): no update', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
    });
    await handler(event);
    expect(update).not.toHaveBeenCalled();
  });

  it('writes effectiveSearchable: true when status/searchable/enrollmentComplete all newly satisfy it', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      profiles: {
        babysitter: { searchable: true, enrollmentComplete: true },
      },
    });
    await handler(event);
    expect(update).toHaveBeenCalledWith({ 'profiles.babysitter.effectiveSearchable': true });
  });

  it('status flip (active -> blocked) recomputes effectiveSearchable to false', async () => {
    const { event, update } = makeEvent({
      status: 'blocked',
      profiles: {
        babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
      },
    });
    await handler(event);
    expect(update).toHaveBeenCalledWith({ 'profiles.babysitter.effectiveSearchable': false });
  });

  it('searchable toggle flip (true -> false) recomputes to false', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      profiles: {
        tutor: { searchable: false, enrollmentComplete: true, effectiveSearchable: true },
      },
    });
    await handler(event);
    expect(update).toHaveBeenCalledWith({ 'profiles.tutor.effectiveSearchable': false });
  });

  it('enrollmentComplete flip (false -> true) recomputes to true', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      profiles: {
        tutor: { searchable: true, enrollmentComplete: true, effectiveSearchable: undefined },
      },
    });
    await handler(event);
    expect(update).toHaveBeenCalledWith({ 'profiles.tutor.effectiveSearchable': true });
  });

  it('SELF-TRIGGER GUARD: already-converged stored value causes no update (breaks the loop)', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      profiles: {
        babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
      },
    });
    await handler(event);
    expect(update).not.toHaveBeenCalled();
  });

  it('already-converged false value also causes no update', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      profiles: {
        babysitter: { searchable: false, enrollmentComplete: true, effectiveSearchable: false },
      },
    });
    await handler(event);
    expect(update).not.toHaveBeenCalled();
  });

  it('a write to an unrelated field with already-converged values touches neither profile', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      updatedAt: 'irrelevant-change',
      profiles: {
        babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
        tutor: { searchable: false, enrollmentComplete: false, effectiveSearchable: false },
      },
    });
    await handler(event);
    expect(update).not.toHaveBeenCalled();
  });

  it('a cross-app user (both babysitter and tutor profiles) patches both dot-paths in one update', async () => {
    const { event, update } = makeEvent({
      status: 'active',
      profiles: {
        babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: false },
        tutor: { searchable: true, enrollmentComplete: false, effectiveSearchable: undefined },
      },
    });
    await handler(event);
    // babysitter newly qualifies (false -> true); tutor still does not
    // (enrollmentComplete false) but was UNSET, so it converges to an
    // explicit false too — both go out in the SAME update call.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      'profiles.babysitter.effectiveSearchable': true,
      'profiles.tutor.effectiveSearchable': false,
    });
  });
});
