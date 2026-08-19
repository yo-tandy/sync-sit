import { create } from 'zustand';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

/**
 * Family verification state, ported from sync-sit's verificationStore
 * (apps/web/src/stores/verificationStore.ts). Verification is a single
 * cross-app fact — both apps share the `families`/`verifications` collections
 * and the same deployed callables (packages/shared-functions/src/verification)
 * — so this store only re-homes the client surface inside study (issue #129:
 * the flow must open in the current app). Divergence from sit: the admin
 * actions (listPendingVerifications / reviewVerification) and the admin
 * enrichment fields are omitted — study has no admin UI.
 */

export interface VerificationDoc {
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

  communityCode: null,
  communityCodeExpires: null,
  communityCodeLoading: false,
  lookupResult: null,
  lookupLoading: false,
  approving: false,

  fetchStatus: async () => {
    set({ loading: true });
    try {
      const fn = httpsCallable<
        Record<string, never>,
        { verification: FamilyVerification; documents: VerificationDoc[] }
      >(functions, 'getVerificationStatus');
      const result = await fn({});
      set({
        familyVerification: result.data.verification,
        documents: result.data.documents,
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

  generateCommunityCode: async () => {
    set({ communityCodeLoading: true });
    try {
      const fn = httpsCallable<
        Record<string, never>,
        { code: string; expiresAt: string }
      >(functions, 'generateCommunityCode');
      const result = await fn({});
      set({
        communityCode: result.data.code,
        communityCodeExpires: result.data.expiresAt,
        communityCodeLoading: false,
      });
    } catch (err) {
      set({ communityCodeLoading: false });
      throw err;
    }
  },

  lookupCommunityCode: async (code: string) => {
    set({ lookupLoading: true, lookupResult: null });
    try {
      const fn = httpsCallable<
        { code: string },
        { familyName: string; firstName: string; lastName: string; familyId: string }
      >(functions, 'lookupCommunityCode');
      const result = await fn({ code });
      set({ lookupResult: result.data, lookupLoading: false });
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
