import type { FirestoreTimestamp } from './common.js';

export type VerificationStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';
export type VerificationType = 'identity' | 'ejm_enrollment';

export interface VerificationDoc {
  verificationId: string;
  familyId: string;
  uploadedByUserId: string;
  type: VerificationType;
  status: VerificationStatus;
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

  createdAt: FirestoreTimestamp;
}

export interface FamilyVerificationStatus {
  identityStatus: VerificationStatus;
  enrollmentStatus: VerificationStatus;
  isFullyVerified: boolean;
  isEjmFamily: boolean;
  communityApprovedBy?: string; // uid of the parent who vouched
}
