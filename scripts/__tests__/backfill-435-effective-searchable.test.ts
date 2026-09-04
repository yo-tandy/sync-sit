import { describe, expect, it } from 'vitest';
// The script guards its main() behind require.main, so importing it here only
// loads the pure helpers (no firebase-admin resolution).
import { computeUserPatch, computeEffective, PROVIDER_KEYS } from '../backfill-435-effective-searchable.cjs';

describe('computeEffective', () => {
  it('matches computeEffectiveSearchable\'s fold-in exactly (status + searchable + enrollmentComplete)', () => {
    expect(computeEffective('active', { searchable: true, enrollmentComplete: true })).toBe(true);
    expect(computeEffective('blocked', { searchable: true, enrollmentComplete: true })).toBe(false);
    expect(computeEffective('active', { searchable: false, enrollmentComplete: true })).toBe(false);
    expect(computeEffective('active', { searchable: true, enrollmentComplete: false })).toBe(false);
    expect(computeEffective('active', {})).toBe(false);
    expect(computeEffective('active', undefined)).toBe(false);
  });
});

describe('PROVIDER_KEYS', () => {
  it('covers exactly babysitter and tutor', () => {
    expect(PROVIDER_KEYS).toEqual(['babysitter', 'tutor']);
  });
});

describe('computeUserPatch', () => {
  it('computes true for an active, searchable, enrolled babysitter with no stored field', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: { babysitter: { searchable: true, enrollmentComplete: true } },
      }),
    ).toEqual({ 'profiles.babysitter.effectiveSearchable': true });
  });

  it('computes false for a hidden (searchable: false) babysitter', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: { babysitter: { searchable: false, enrollmentComplete: true } },
      }),
    ).toEqual({ 'profiles.babysitter.effectiveSearchable': false });
  });

  it('computes false for a blocked user regardless of the other two inputs', () => {
    expect(
      computeUserPatch({
        status: 'blocked',
        profiles: { babysitter: { searchable: true, enrollmentComplete: true } },
      }),
    ).toEqual({ 'profiles.babysitter.effectiveSearchable': false });
  });

  it('computes false for a mid-enrollment (enrollmentComplete: false) tutor', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: { tutor: { searchable: true, enrollmentComplete: false } },
      }),
    ).toEqual({ 'profiles.tutor.effectiveSearchable': false });
  });

  it('handles both provider profiles on the same (cross-app) doc, one per key', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: {
          babysitter: { searchable: true, enrollmentComplete: true },
          tutor: { searchable: false, enrollmentComplete: true },
        },
      }),
    ).toEqual({
      'profiles.babysitter.effectiveSearchable': true,
      'profiles.tutor.effectiveSearchable': false,
    });
  });

  it('returns null (no patch) when no provider profile is present at all', () => {
    expect(
      computeUserPatch({ status: 'active', profiles: { parent: { enrollmentComplete: true } } }),
    ).toBeNull();
    expect(computeUserPatch({ status: 'active', profiles: {} })).toBeNull();
    expect(computeUserPatch({ status: 'active' })).toBeNull();
  });

  // IDEMPOTENCY: the core contract this backfill relies on for a safe re-run.
  it('IDEMPOTENT: returns null when the stored value already matches the computed one (true)', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: {
          babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
        },
      }),
    ).toBeNull();
  });

  it('IDEMPOTENT: returns null when the stored value already matches the computed one (false)', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: {
          babysitter: { searchable: false, enrollmentComplete: true, effectiveSearchable: false },
        },
      }),
    ).toBeNull();
  });

  it('re-patches when the stored value is STALE relative to the current inputs', () => {
    // e.g. status flipped to blocked after the field was last computed, and
    // for whatever reason the write-trigger never caught up.
    expect(
      computeUserPatch({
        status: 'blocked',
        profiles: {
          babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
        },
      }),
    ).toEqual({ 'profiles.babysitter.effectiveSearchable': false });
  });

  it('a doc with BOTH profiles already converged patches neither (partial idempotency)', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: {
          babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
          tutor: { searchable: false, enrollmentComplete: true, effectiveSearchable: false },
        },
      }),
    ).toBeNull();
  });

  it('a doc with ONE profile converged and one stale patches only the stale one', () => {
    expect(
      computeUserPatch({
        status: 'active',
        profiles: {
          babysitter: { searchable: true, enrollmentComplete: true, effectiveSearchable: true },
          // tutor was hidden after its effectiveSearchable was last computed.
          tutor: { searchable: false, enrollmentComplete: true, effectiveSearchable: true },
        },
      }),
    ).toEqual({ 'profiles.tutor.effectiveSearchable': false });
  });
});
