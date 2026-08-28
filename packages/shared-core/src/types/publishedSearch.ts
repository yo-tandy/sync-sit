import type { RecurringSlot } from './appointment.js';

/**
 * Published searches (issue #207): a family's deliberately-broadcast demand.
 *
 * One shared `publishedSearches` collection for both apps (they share the
 * Firestore DB and rules file), discriminated by `app` — one rules block, one
 * TTL sweep, one index family. Docs are created EXCLUSIVELY by the per-app
 * publish callables (publishSearch / publishTutorSearch): the verification
 * gate, the server-computed expiry, and the PII scrubbing live there. Withdraw
 * is a rules-gated owner-family client delete.
 *
 * PII stance (owner default, issue #207 Q1): the doc carries the AREA LABEL
 * (resolveAreaLabel from the family doc's postcode/city) and never the
 * address or latLng; kid AGES and never kid names. `familyName` is included —
 * both apps already show it to providers pre-accept in the family-initiated
 * flows — but dropping it is a one-field change if the owner overrides Q1.
 *
 * Expiry: `expiresAt` is computed server-side — min(now + 7d, end of the
 * babysitting day) for sit one_time, plain now + 7d otherwise. There is no
 * `status` field: active == exists && expiresAt > now. Clients filter
 * client-side; the daily cleanup sweep deletes expired docs; the contact
 * callables (PR3/PR4) re-check server-side.
 */

interface PublishedSearchBase {
  id: string; // == doc id
  familyId: string;
  createdByUserId: string;
  /** Denormalized display name — see the Q1 PII stance above. */
  familyName: string;
  /** Coverage-area label ('16e', 'Vincennes', ...) or null; NEVER address/latLng. */
  areaLabel: string | null;
  createdAt: unknown; // Firestore Timestamp (admin or client SDK)
  expiresAt: unknown; // Firestore Timestamp (admin or client SDK)
}

/** A published sync-sit babysitting search. */
export interface PublishedSitSearch extends PublishedSearchBase {
  app: 'sit';
  type: 'one_time' | 'recurring';
  date: string | null; // "YYYY-MM-DD" (one_time only)
  startTime: string | null; // "HH:MM" (one_time only)
  endTime: string | null;
  recurringSlots: RecurringSlot[] | null; // recurring only
  schoolWeeksOnly: boolean;
  /** Opaque kid-doc ids — needed to mint the appointment at contact time (PR3). */
  kidIds: string[];
  /** Server-derived from the kid docs (client ages are not trusted). Display only. */
  kidAges: number[];
  numberOfKids: number;
  offeredRate: number | null;
  /** Family-authored free text; the publish dialog warns it is provider-visible. */
  additionalInfo: string | null;
}

/** A published sync-study tutoring search. */
export interface PublishedStudySearch extends PublishedSearchBase {
  app: 'study';
  subject: string;
  level: string;
  locationPrefs: string[]; // may be []
  maxRate: number | null;
}

export type PublishedSearch = PublishedSitSearch | PublishedStudySearch;
