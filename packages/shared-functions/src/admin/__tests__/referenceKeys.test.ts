import { describe, it, expect } from 'vitest';
import { ENDORSEMENT_SUBJECT_FIELD } from '@ejm/shared-core';
import { REFERENCE_PROVIDER_KEYS } from '../referenceKeys.js';

/**
 * These keys drive GDPR export and erasure (exportUserData / deleteUser), so
 * their failure mode is silent: a key missing here means a deleted provider's
 * endorsements simply survive, with nothing raised. Derived from the shared
 * cross-app registry (issue #280) precisely so the rendering surfaces and the
 * erasure sweep cannot drift apart.
 */
describe('REFERENCE_PROVIDER_KEYS', () => {
  it('covers every provider key the cross-app registry knows about', () => {
    expect([...REFERENCE_PROVIDER_KEYS].sort()).toEqual(
      Object.values(ENDORSEMENT_SUBJECT_FIELD).sort(),
    );
  });

  it('still contains the three known keys, in registry order', () => {
    // Belt-and-braces against the registry and this list being edited in
    // lockstep to something wrong — the derivation makes them agree, not
    // makes them correct.
    expect(REFERENCE_PROVIDER_KEYS).toEqual([
      'babysitterUserId',
      'tutorUserId',
      'doerUserId',
    ]);
  });

  it('is frozen at runtime — Object.values hands back a mutable array', () => {
    // The asymmetry that justifies the freeze: a stray mutation of the
    // RENDERING registry costs a missing badge; of THIS list, a provider's
    // endorsements outliving their account deletion.
    expect(Object.isFrozen(REFERENCE_PROVIDER_KEYS)).toBe(true);
    expect(() =>
      (REFERENCE_PROVIDER_KEYS as unknown as string[]).push('somethingElse'),
    ).toThrow();
    expect(REFERENCE_PROVIDER_KEYS).toHaveLength(3);
  });
});
