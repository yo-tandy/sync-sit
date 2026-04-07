import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { ReferenceDoc } from '@ejm/shared';

export function useSubmittedEndorsements() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [references, setReferences] = useState<ReferenceDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

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
