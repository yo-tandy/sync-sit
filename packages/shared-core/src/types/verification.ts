import type { FirestoreTimestamp } from './common.js';

export type VerificationStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';
export type VerificationType = 'identity' | 'ejm_enrollment' | 'tutor_identity';

export interface VerificationDoc {
  verificationId: string;
  /** Absent on tutor_identity docs — tutor docs are keyed by uploadedByUserId. */
  familyId?: string;
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

/** Verification state stored on users/{uid}.profiles.tutor.verification */
export interface TutorVerificationStatus {
  identityStatus: VerificationStatus;
}
