import type { FirestoreTimestamp } from '@ejm/shared-core';

/**
 * Lifecycle status of a study contact request.
 * pending → accepted | declined (terminal). Only the tutor transitions it,
 * via the respondToTutorContactRequest callable.
 */
export type StudyContactRequestStatus = 'pending' | 'accepted' | 'declined';

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
  /** users/{uid} of the parent who created the request. */
  createdByUserId: string;
  /** Subject key requested (must be in SUBJECTS). */
  subject: string;
  /** Class level requested (must be in CLASS_LEVELS). */
  level: string;
  /** Optional free-text message from the parent (<= 1000 chars). */
  message?: string;
  status: StudyContactRequestStatus;
  createdAt: FirestoreTimestamp;
  respondedAt?: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
