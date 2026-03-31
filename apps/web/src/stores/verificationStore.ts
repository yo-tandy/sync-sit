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

  // Community verification
  communityCode: string | null;
  communityCodeExpires: string | null;
  communityCodeLoading: boolean;
  lookupResult: { familyName: string; firstName: string; lastName: string; familyId: string } | null;
  lookupLoading: boolean;
  approving: boolean;

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
  generateCommunityCode: () => Promise<void>;
  lookupCommunityCode: (code: string) => Promise<void>;
  approveCommunityCode: (code: string) => Promise<void>;
  clearLookup: () => void;
}

export const useVerificationStore = create<VerificationState>((set) => ({
  familyVerification: null,
  documents: [],
  loading: false,
  uploading: false,
  pendingVerifications: [],
  pendingLoading: false,

  communityCode: null,
  communityCodeExpires: null,
  communityCodeLoading: false,
  lookupResult: null,
  lookupLoading: false,
  approving: false,

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

  generateCommunityCode: async () => {
    set({ communityCodeLoading: true });
    try {
      const fn = httpsCallable(functions, 'generateCommunityCode');
      const result = await fn({});
      const data = result.data as any;
      set({ communityCode: data.code, communityCodeExpires: data.expiresAt, communityCodeLoading: false });
    } catch (err) {
      set({ communityCodeLoading: false });
      throw err;
    }
  },

  lookupCommunityCode: async (code: string) => {
    set({ lookupLoading: true, lookupResult: null });
    try {
      const fn = httpsCallable(functions, 'lookupCommunityCode');
      const result = await fn({ code });
      set({ lookupResult: result.data as any, lookupLoading: false });
    } catch (err) {
      set({ lookupLoading: false });
      throw err;
    }
  },

  approveCommunityCode: async (code: string) => {
    set({ approving: true });
    try {
      const fn = httpsCallable(functions, 'approveCommunityCode');
      await fn({ code });
      set({ approving: false, lookupResult: null });
    } catch (err) {
      set({ approving: false });
      throw err;
    }
  },

  clearLookup: () => set({ lookupResult: null }),
}));
