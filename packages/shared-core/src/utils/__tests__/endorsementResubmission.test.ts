import { describe, it, expect } from 'vitest';
import {
  endorsementResubmissionState,
  ENDORSEMENT_RESUBMISSION_COOLDOWN_MS,
} from '../endorsementResubmission.js';
import { ENDORSEMENT_RESUBMISSION_COOLDOWN_DAYS } from '../../constants/endorsements.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-11T00:00:00.000Z');

describe('ENDORSEMENT_RESUBMISSION_COOLDOWN_MS', () => {
  it('is the day constant converted to ms', () => {
    expect(ENDORSEMENT_RESUBMISSION_COOLDOWN_MS).toBe(ENDORSEMENT_RESUBMISSION_COOLDOWN_DAYS * DAY_MS);
    expect(ENDORSEMENT_RESUBMISSION_COOLDOWN_DAYS).toBe(30);
  });
});

describe('endorsementResubmissionState', () => {
  it('allows a first-ever submission (no existing docs)', () => {
    expect(endorsementResubmissionState([], NOW)).toEqual({ allowed: true });
  });

  it('blocks on a LIVE pending doc ("private")', () => {
    expect(
      endorsementResubmissionState(
        [{ status: 'private', updatedAtMs: NOW.getTime() }],
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'live' });
  });

  it('blocks on a LIVE approved doc', () => {
    expect(
      endorsementResubmissionState(
        [{ status: 'approved', updatedAtMs: NOW.getTime() - 400 * DAY_MS }],
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'live' });
  });

  it('blocks within the cool-down after a decline, with the correct retryAt', () => {
    const declinedAt = NOW.getTime() - 10 * DAY_MS;
    const result = endorsementResubmissionState(
      [{ status: 'removed', updatedAtMs: declinedAt }],
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: 'cooldown' });
    const retryAt = (result as { retryAt: Date }).retryAt;
    expect(retryAt.getTime()).toBe(declinedAt + ENDORSEMENT_RESUBMISSION_COOLDOWN_MS);
    // 20 days remain of the 30-day window.
    expect(retryAt.getTime() - NOW.getTime()).toBe(20 * DAY_MS);
  });

  it('allows resubmission once the cool-down has fully elapsed (40 days)', () => {
    const declinedAt = NOW.getTime() - 40 * DAY_MS;
    expect(
      endorsementResubmissionState([{ status: 'removed', updatedAtMs: declinedAt }], NOW),
    ).toEqual({ allowed: true });
  });

  it('is allowed exactly AT the retry boundary (>=, not >)', () => {
    const declinedAt = NOW.getTime() - ENDORSEMENT_RESUBMISSION_COOLDOWN_MS;
    expect(
      endorsementResubmissionState([{ status: 'removed', updatedAtMs: declinedAt }], NOW),
    ).toEqual({ allowed: true });
  });

  it('is still blocked one millisecond before the boundary', () => {
    const declinedAt = NOW.getTime() - ENDORSEMENT_RESUBMISSION_COOLDOWN_MS + 1;
    const result = endorsementResubmissionState(
      [{ status: 'removed', updatedAtMs: declinedAt }],
      NOW,
    );
    expect(result.allowed).toBe(false);
  });

  it('anchors on the MOST RECENT decline when several exist', () => {
    const oldDecline = NOW.getTime() - 400 * DAY_MS; // long expired
    const recentDecline = NOW.getTime() - 5 * DAY_MS; // still cooling down
    const result = endorsementResubmissionState(
      [
        { status: 'removed', updatedAtMs: oldDecline },
        { status: 'removed', updatedAtMs: recentDecline },
      ],
      NOW,
    );
    expect(result).toMatchObject({ reason: 'cooldown' });
    expect((result as { retryAt: Date }).retryAt.getTime()).toBe(
      recentDecline + ENDORSEMENT_RESUBMISSION_COOLDOWN_MS,
    );
  });

  it('a live doc blocks even alongside an old, long-expired decline', () => {
    const result = endorsementResubmissionState(
      [
        { status: 'removed', updatedAtMs: NOW.getTime() - 400 * DAY_MS },
        { status: 'private', updatedAtMs: NOW.getTime() - 1 * DAY_MS },
      ],
      NOW,
    );
    expect(result).toEqual({ allowed: false, reason: 'live' });
  });

  it('treats any non-live status as a decline anchor (both callables only ever write private/approved/removed)', () => {
    // `type` is always 'family_submitted' for study/do endorsement docs, so
    // `status` is constrained to private/approved/removed by construction —
    // but the helper does not special-case 'removed', it just anchors on
    // whatever is NOT live, which is the simpler and equally correct rule.
    expect(
      endorsementResubmissionState([{ status: 'removed', updatedAtMs: NOW.getTime() }], NOW),
    ).toEqual({ allowed: false, reason: 'cooldown', retryAt: new Date(NOW.getTime() + ENDORSEMENT_RESUBMISSION_COOLDOWN_MS) });
  });
});
