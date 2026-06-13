import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { ReferenceDoc } from '@ejm/sit-core';

export function useSubmittedEndorsements() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [references, setReferences] = useState<ReferenceDoc[]>([]);
  // Initial loading state derives from uid: if there is no signed-in user
  // we have nothing to fetch, so we are already "done" loading. The
  // snapshot callback below flips this back to false once Firestore has
  // returned the first page of data for a valid uid.
  const [loading, setLoading] = useState<boolean>(Boolean(uid));

  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(db, 'references'),
      where('submittedByUserId', '==', uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const refs = snap.docs
        .map((d) => ({ ...d.data(), referenceId: d.id }) as ReferenceDoc)
        .filter((r) => r.status !== 'removed');
      setReferences(refs);
      setLoading(false);
    });

    return unsub;
  }, [uid]);

  return { references, loading };
}
