import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { suspectReasons, SUSPECT_REASONS } = require('../audit-354-forged-tutor-endorsements.cjs');

/**
 * Classification pins for the #354 audit. The script is read-only and its
 * whole value is the judgement in this function — a false negative means an
 * unremovable forged endorsement stays on a tutor's page and the sweep says
 * "none found", which is worse than not sweeping.
 */
const legit = {
  tutorUserId: 't1',
  appSource: 'study',
  type: 'family_submitted',
  submittedByUserId: 'p1',
};

describe('suspectReasons', () => {
  it('clears a legitimate study endorsement', () => {
    expect(suspectReasons(legit)).toEqual([]);
  });

  it('flags the injection signature: a foreign babysitterUserId', () => {
    // The attacker writes about themselves (babysitterUserId is pinned to the
    // caller by the create rule) while carrying the victim's tutorUserId.
    const r = suspectReasons({ ...legit, babysitterUserId: 'attacker', submittedByUserId: 'attacker2' });
    expect(r).toContain(SUSPECT_REASONS.FOREIGN_SUBMITTER);
  });

  it("flags a type the response callable would refuse", () => {
    expect(suspectReasons({ ...legit, type: 'manual' })).toContain(SUSPECT_REASONS.WRONG_TYPE);
  });

  it('flags another app’s appSource', () => {
    expect(suspectReasons({ ...legit, appSource: 'do' })).toContain(SUSPECT_REASONS.WRONG_APP);
  });

  it('does NOT flag a self-submitted row whose babysitterUserId is the submitter', () => {
    // A sit manual reference about oneself is legitimate on the sit side; only
    // the foreign-recipient combination is the attack. Flagging it would bury
    // real hits in noise.
    expect(
      suspectReasons({ ...legit, babysitterUserId: 'p1', submittedByUserId: 'p1' }),
    ).not.toContain(SUSPECT_REASONS.FOREIGN_SUBMITTER);
  });

  it('ignores documents with no tutorUserId at all', () => {
    // Those cannot reach the study surface whatever their shape.
    expect(suspectReasons({ type: 'manual', babysitterUserId: 'b1' })).toEqual([]);
    expect(suspectReasons(undefined)).toEqual([]);
  });
});
