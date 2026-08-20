import type { FirestoreTimestamp } from '@ejm/shared-core';

/**
 * Lifecycle status of a study contact request.
 * pending → accepted | declined (tutor-driven, terminal) OR pending → cancelled
 * (family-driven, terminal). The tutor transitions accepted/declined via
 * respondToTutorContactRequest; 'cancelled' is FAMILY-initiated (the family
 * withdraws its own pending request via cancelContactRequest) and is distinct
 * from the tutor's 'declined' — notably it does NOT trigger the 7-day re-request
 * cooldown, so a family may re-send immediately after cancelling.
 */
export type StudyContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/**
 * A parent's request to unlock a tutor's contact details. Lives at
 * studyContactRequests/{requestId}. Server-owned: created by
 * sendTutorContactRequest, transitioned by respondToTutorContactRequest;
 * client writes are blocked by security rules.
 *
 * Denormalizes family/parent display fields so the tutor's RequestsPage can
 * render the list without extra lookups (mirrors contactSharingRequests).
 */
export interface StudyContactRequestDoc {
  requestId: string;
  /** users/{uid} of the tutor receiving the request. */
  tutorUserId: string;
  /** families/{familyId} of the requesting family. */
  familyId: string;
  /** Denormalized family display name (e.g. 'Dupont'). */
  familyName: string;
  /** Denormalized display name of the parent who sent the request. */
  parentName: string;
  /**
   * Denormalized tutor display name so the FAMILY's requests list can render
   * without a users/{tutorUserId} read (rules do not let parents read tutor
   * user docs).
   */
  tutorName: string;
  /** users/{uid} of the caller who created the request (parent or tutor). */
  createdByUserId: string;
  /**
   * Who opened this conversation. ABSENT means 'family' — the inversion
   * (issue #207 PR4) is new, so every legacy doc is family-initiated by
   * construction. A tutor-initiated request is answered by a PARENT, through
   * respondToFamilyContactRequest, and its `parentName` is empty until then.
   */
  initiatedBy?: 'tutor';
  /** The publishedSearches doc a tutor-initiated request answers. */
  publishedSearchId?: string;
  /** Subject key requested (must be in SUBJECTS). */
  subject: string;
  /** Class level requested (must be in CLASS_LEVELS). */
  level: string;
  /** Optional free-text message from the sender (<= 1000 chars). */
  message?: string;
  status: StudyContactRequestStatus;
  createdAt: FirestoreTimestamp;
  respondedAt?: FirestoreTimestamp;
  /** When the family cancelled its own pending request (status → 'cancelled'). */
  cancelledAt?: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
