import { describe, it, expect } from 'vitest';
import { isCurrentConsentVersion, needsReconsent } from '../consent.js';
import {
  CONSENT_VERSION,
  CONSENT_VERSION_ALIASES,
  INITIAL_CONSENT_VERSION,
} from '../../constants/config.js';

/**
 * The re-consent gate's staleness rule (issue #488 decision 1). Pinned with
 * an explicit `current` where the semantics of a FUTURE bump are what is
 * being tested, since the live constant has never been bumped.
 */
describe('isCurrentConsentVersion', () => {
  it('the live version is current', () => {
    expect(isCurrentConsentVersion(CONSENT_VERSION)).toBe(true);
  });

  it("the live version's alias labels are current -- study's and do's pre-unification stamps are not stale", () => {
    // Guards the guard: the live version must actually carry aliases today,
    // or this pins nothing.
    const aliases = CONSENT_VERSION_ALIASES[CONSENT_VERSION] ?? [];
    expect(aliases.length).toBeGreaterThan(0);
    for (const label of aliases) {
      expect(isCurrentConsentVersion(label)).toBe(true);
    }
    expect(isCurrentConsentVersion('2025-12-01')).toBe(true);
    expect(isCurrentConsentVersion('2026-08-28')).toBe(true);
  });

  it('nothing stored reads as the initial version -- current today, stale after the first bump', () => {
    expect(INITIAL_CONSENT_VERSION).toBe(CONSENT_VERSION); // no bump has happened
    expect(isCurrentConsentVersion(undefined)).toBe(true);
    expect(isCurrentConsentVersion(null)).toBe(true);
    expect(isCurrentConsentVersion(undefined, '2.0')).toBe(false);
  });

  it('an unrelated label is stale', () => {
    expect(isCurrentConsentVersion('0.9')).toBe(false);
    expect(isCurrentConsentVersion('2024-01-01')).toBe(false);
  });

  it('a bump retires the old aliases: they are looked up by the CURRENT version, not stored anywhere else', () => {
    // Simulate the bump the counsel sign-off will make (#488 decision 3).
    expect(isCurrentConsentVersion('1.0', '2.0')).toBe(false);
    expect(isCurrentConsentVersion('2025-12-01', '2.0')).toBe(false);
    expect(isCurrentConsentVersion('2026-08-28', '2.0')).toBe(false);
    expect(isCurrentConsentVersion('2.0', '2.0')).toBe(true);
  });
});

describe('needsReconsent', () => {
  it('no doc -> nothing to gate', () => {
    expect(needsReconsent(null)).toBe(false);
    expect(needsReconsent(undefined)).toBe(false);
  });

  it('a doc on the live version, an alias, or with no field -> no gate', () => {
    expect(needsReconsent({ consentVersion: CONSENT_VERSION })).toBe(false);
    expect(needsReconsent({ consentVersion: '2026-08-28' })).toBe(false);
    expect(needsReconsent({})).toBe(false);
  });

  it('a doc on a stale version -> gate', () => {
    expect(needsReconsent({ consentVersion: '0.9' })).toBe(true);
    expect(needsReconsent({ consentVersion: '1.0' }, '2.0')).toBe(true);
  });
});
