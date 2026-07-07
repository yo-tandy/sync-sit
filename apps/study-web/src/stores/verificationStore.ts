import { create } from 'zustand';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, functions, storage } from '@/config/firebase';

/**
 * Tutor-only verification store — the identity-document subset of apps/web's
 * family verificationStore. Backend contract (PR #77):
 *   getVerificationStatus({ role: 'tutor' })
 *     -> { verification: { identityStatus }, documents: [...] }
 *   submitVerification({ type: 'tutor_identity', fileUrl, fileName })
 * Documents come back newest-first (ordered by createdAt desc), so documents[0]
 * is the latest submission — the one whose status/rejectionReason we surface.
 */

export interface TutorVerificationDoc {
  id: string;
  status: string;
  fileUrl?: string;
  fileName?: string;
  rejectionReason?: string;
  createdAt?: string;
  reviewedAt?: string;
}

export interface TutorVerification {
  identityStatus: string;
}

interface VerificationState {
  verification: TutorVerification | null;
  documents: TutorVerificationDoc[];
  loading: boolean;
  uploading: boolean;
  error: string | null;

  fetchStatus: () => Promise<void>;
  submit: (file: File) => Promise<void>;
}

export const useVerificationStore = create<VerificationState>((set) => ({
  verification: null,
  documents: [],
  loading: false,
  uploading: false,
  error: null,

  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const fn = httpsCallable<
        { role: 'tutor' },
        { verification: TutorVerification; documents: TutorVerificationDoc[] }
      >(functions, 'getVerificationStatus');
      const result = await fn({ role: 'tutor' });
      set({
        verification: result.data.verification,
        documents: result.data.documents,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  submit: async (file: File) => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    set({ uploading: true, error: null });
    try {
      const path = `verification-documents/${uid}/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const fileUrl = await getDownloadURL(storageRef);
      const fn = httpsCallable(functions, 'submitVerification');
      await fn({ type: 'tutor_identity', fileUrl, fileName: file.name });
      set({ uploading: false });
    } catch (err) {
      set({ uploading: false });
      throw err;
    }
  },
}));
