import { create } from 'zustand';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

interface VerificationDoc {
  id: string;
  familyId: string;
  uploadedByUserId: string;
  type: 'identity' | 'ejm_enrollment';
  status: string;
  fileUrl: string;
  fileName: string;
  childName?: string;
  childDob?: string;
  schoolYear?: string;
  classLevel?: string;
  signerName?: string;
  reviewedByAdminId?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  // Enriched (admin)
  familyName?: string;
  parentName?: string;
}

interface FamilyVerification {
  identityStatus: string;
  enrollmentStatus: string;
  isFullyVerified: boolean;
  isEjmFamily: boolean;
}

interface VerificationState {
  familyVerification: FamilyVerification | null;
  documents: VerificationDoc[];
  loading: boolean;
  uploading: boolean;

  // Admin
  pendingVerifications: VerificationDoc[];
  pendingLoading: boolean;

  // Actions
  fetchStatus: () => Promise<void>;
  submitDocument: (data: {
    type: 'identity' | 'ejm_enrollment';
    fileUrl: string;
    fileName: string;
    childName?: string;
    childDob?: string;
    schoolYear?: string;
    classLevel?: string;
    signerName?: string;
  }) => Promise<void>;
  fetchPendingVerifications: (params: { status?: string; type?: string }) => Promise<void>;
  reviewVerification: (verificationId: string, decision: 'approved' | 'rejected', rejectionReason?: string) => Promise<void>;
}

export const useVerificationStore = create<VerificationState>((set) => ({
  familyVerification: null,
  documents: [],
  loading: false,
  uploading: false,
  pendingVerifications: [],
  pendingLoading: false,

  fetchStatus: async () => {
    set({ loading: true });
    try {
      const fn = httpsCallable(functions, 'getVerificationStatus');
      const result = await fn({});
      const data = result.data as any;
      set({
        familyVerification: data.verification,
        documents: data.documents,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  submitDocument: async (data) => {
    set({ uploading: true });
    try {
      const fn = httpsCallable(functions, 'submitVerification');
      await fn(data);
      set({ uploading: false });
    } catch (err) {
      set({ uploading: false });
      throw err;
    }
  },

  fetchPendingVerifications: async (params) => {
    set({ pendingLoading: true });
    try {
      const fn = httpsCallable(functions, 'listPendingVerifications');
      const result = await fn({
        statusFilter: params.status,
        typeFilter: params.type,
      });
      set({
        pendingVerifications: (result.data as any).verifications,
        pendingLoading: false,
      });
    } catch {
      set({ pendingLoading: false });
    }
  },

  reviewVerification: async (verificationId, decision, rejectionReason) => {
    const fn = httpsCallable(functions, 'reviewVerification');
    await fn({ verificationId, decision, rejectionReason });
  },
}));
