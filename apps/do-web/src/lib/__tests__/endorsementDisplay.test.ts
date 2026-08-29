import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { FirestoreTimestamp } from '@ejm/shared-core';
import { formatEndorsementDate } from '../endorsementDisplay';

/**
 * `formatEndorsementDate` handles two shapes, and until issue #357 item 3
 * only the emulator/Admin-SDK `Date` one was covered — the helper's own doc
 * comment says the Firestore `Timestamp` is what PRODUCTION returns, so the
 * untested branch was the one that actually runs for every real endorsement.
 *
 * A REAL `Timestamp` from the firebase SDK, not a `{ toDate }` stand-in: a
 * hand-rolled fake would pass a `typeof toDate === 'function'` check that a
 * genuine Timestamp could in principle fail (a bundling or version change
 * that swapped `toDate` for a getter, say), which is exactly the class of
 * production-only breakage this test exists to catch.
 */
const WHEN = new Date('2026-08-01T10:00:00Z');

describe('formatEndorsementDate — the Firestore Timestamp branch (production)', () => {
  it('renders a real Timestamp in EN', () => {
    expect(formatEndorsementDate(Timestamp.fromDate(WHEN), 'en')).toBe('Aug 1, 2026');
  });

  it('renders a real Timestamp in FR', () => {
    expect(formatEndorsementDate(Timestamp.fromDate(WHEN), 'fr')).toBe('1 août 2026');
  });

  it('agrees with the Date branch for the same instant', () => {
    // The two shapes must not render differently — a parent and a student
    // looking at the same endorsement from different code paths would
    // otherwise see different dates.
    expect(formatEndorsementDate(Timestamp.fromDate(WHEN), 'en')).toBe(
      formatEndorsementDate(WHEN as unknown as FirestoreTimestamp, 'en'),
    );
  });
});

describe('formatEndorsementDate — the Date branch and the degradations', () => {
  it('renders a plain Date (emulator / Admin-SDK write read back)', () => {
    expect(formatEndorsementDate(WHEN as unknown as FirestoreTimestamp, 'en')).toBe(
      'Aug 1, 2026',
    );
  });

  it('falls back to en-US for any language that is not fr', () => {
    expect(formatEndorsementDate(Timestamp.fromDate(WHEN), 'de')).toBe('Aug 1, 2026');
  });

  it("returns '' rather than throwing or printing 'Invalid Date'", () => {
    // A missing timestamp must degrade the meta line, never the endorsement.
    expect(formatEndorsementDate(undefined, 'en')).toBe('');
    expect(formatEndorsementDate(new Date('nonsense') as unknown as FirestoreTimestamp, 'en')).toBe('');
    expect(formatEndorsementDate(null as unknown as FirestoreTimestamp, 'en')).toBe('');
    expect(formatEndorsementDate('2026-08-01' as unknown as FirestoreTimestamp, 'en')).toBe('');
    expect(formatEndorsementDate({} as unknown as FirestoreTimestamp, 'en')).toBe('');
  });
});
