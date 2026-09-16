import { useCallback } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Language } from '@ejm/shared-core';
import { useSyncUserLanguage } from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';

/**
 * Writes the UI language back to `users/{uid}.language` whenever it changes
 * while someone is signed in (issue #512). Mounted once at the app root next
 * to ForcedSignOutWatcher; the listening and dedupe live in the shared hook,
 * this file only supplies the app's Firestore handle. Renders nothing.
 */
export function UserLanguageSync() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid ?? null);
  const write = useCallback(
    async (language: Language) => {
      if (!uid) return;
      await updateDoc(doc(db, 'users', uid), { language, updatedAt: serverTimestamp() });
    },
    [uid],
  );
  useSyncUserLanguage(uid, write);
  return null;
}
