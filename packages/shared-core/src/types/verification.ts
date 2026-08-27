import type { FirestoreTimestamp } from './common.js';

export type VerificationStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';

/**
 * Status of a single uploaded document. Distinct from VerificationStatus,
 * which describes a family's standing per type: a document is `superseded`
 * when the family reached verified by another route while it still sat in the
 * admin queue (#218), but a family's identityStatus is never `superseded` —
 * that route set it to `approved`.
 */
export type VerificationDocStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export type VerificationType = 'identity' | 'ejm_enrollment';

export interface VerificationDoc {
  verificationId: string;
  familyId: string;
  uploadedByUserId: string;
  type: VerificationType;
  status: VerificationDocStatus;
  fileUrl: string;
  fileName: string;

  // EJM enrollment fields (only for type === 'ejm_enrollment')
  childName?: string;
  childDob?: string; // "YYYY-MM-DD"
  schoolYear?: string; // "2025-2026"
  classLevel?: string;
  signerName?: string;

  // Review fields (set by admin)
  reviewedByAdminId?: string;
  reviewedAt?: FirestoreTimestamp;
  rejectionReason?: string;

  // Set when the community route verified the family, closing a document
  // request the grant made moot — either one an admin had not reached yet, or
  // one they had already rejected and the family routed around (#218). Only
  // that route supersedes — see supersedeOpenVerifications.
  supersededAt?: FirestoreTimestamp;
  supersededBy?: 'community';

  createdAt: FirestoreTimestamp;
}

export interface FamilyVerificationStatus {
  identityStatus: VerificationStatus;
  enrollmentStatus: VerificationStatus;
  isFullyVerified: boolean;
  isEjmFamily: boolean;
  communityApprovedBy?: string; // uid of the parent who vouched
}
