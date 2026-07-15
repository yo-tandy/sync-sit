import type { FirestoreTimestamp, ReferenceStatus } from '@ejm/shared-core';

/**
 * A family-submitted endorsement of a tutor. Stored in the SHARED
 * `references` collection (reusing that collection's infrastructure) but keyed
 * by `tutorUserId` + `appSource: 'study'` instead of `babysitterUserId`, so the
 * sit-side onReferenceCreated trigger early-returns for these docs.
 *
 * Mirrors ReferenceDoc's family-submitted subset. Status vocabulary is
 * identical to references: private (awaiting tutor) → approved | removed.
 */
export interface TutorEndorsementDoc {
  referenceId: string;
  /** users/{uid} of the endorsed tutor. Replaces ReferenceDoc.babysitterUserId. */
  tutorUserId: string;
  /** Discriminates study endorsements from sit references in the shared collection. */
  appSource: 'study';
  /** Always family-submitted for tutor endorsements. */
  type: 'family_submitted';
  status: ReferenceStatus;

  /** users/{uid} of the parent who submitted the endorsement. */
  submittedByUserId: string;
  /** families/{familyId} the endorsement was submitted from. */
  submittedByFamilyId: string;
  /** Denormalized display name of the submitting parent. */
  submittedByName?: string;
  /** Reference contact name provided by the family. */
  refName?: string;
  /** Free-text endorsement body (>= 10 chars). */
  referenceText: string;
  /** Optional subject key the endorsement pertains to. */
  subject?: string;
  /** Whether the submitting family is an EJM family (copied at write time). */
  isEjmFamily?: boolean;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  approvedAt?: FirestoreTimestamp;
}
