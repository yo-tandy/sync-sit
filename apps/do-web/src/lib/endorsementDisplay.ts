import type { FirestoreTimestamp } from '@ejm/shared-core';

/**
 * Render an endorsement's `createdAt` as a short localized date.
 *
 * Handles BOTH shapes the field arrives in: a Firestore `Timestamp` in
 * production, and a plain `Date` from an emulator-written row or an
 * Admin-SDK write read back before conversion (the study `EndorsementsPage`
 * precedent — its comment records the same two cases). Anything else
 * returns '' rather than throwing or printing "Invalid Date": a missing
 * timestamp must degrade the meta line, never the endorsement.
 */
export function formatEndorsementDate(
  value: FirestoreTimestamp | undefined,
  language: string,
): string {
  const raw: unknown = value;
  const date =
    raw instanceof Date
      ? raw
      : raw && typeof (raw as { toDate?: unknown }).toDate === 'function'
        ? (raw as { toDate: () => Date }).toDate()
        : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
