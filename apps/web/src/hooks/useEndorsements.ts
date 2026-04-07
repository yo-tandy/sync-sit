import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { ReferenceDoc } from '@ejm/shared';

interface ManualRefInput {
  refName: string;
  refPhone?: string;
  refEmail?: string;
  isEjmFamily?: boolean;
  numberOfKids?: number;
  kidAges?: number[];
  note?: string;
}

export function useEndorsements() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const [loading, setLoading] = useState(true);
  const [manualRefs, setManualRefs] = useState<ReferenceDoc[]>([]);
  const [familySubmittedRefs, setFamilySubmittedRefs] = useState<ReferenceDoc[]>([]);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'references'),
      where('babysitterUserId', '==', uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const _manual: ReferenceDoc[] = [];
      const _familySubmitted: ReferenceDoc[] = [];

      snap.docs.forEach((d) => {
        const ref = { ...d.data(), referenceId: d.id } as ReferenceDoc;
        if (ref.status === 'removed') return;

        if (ref.type === 'manual') {
          _manual.push(ref);
        } else if (ref.type === 'family_submitted') {
          _familySubmitted.push(ref);
        }
      });

      setManualRefs(_manual);
      setFamilySubmittedRefs(_familySubmitted);
      setLoading(false);
    });

    return unsub;
  }, [uid]);

  const addManualReference = useCallback(
    async (data: ManualRefInput) => {
      if (!uid) return;
      const cleaned = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
      );
      await addDoc(collection(db, 'references'), {
        babysitterUserId: uid,
        type: 'manual',
        status: 'private',
        ...cleaned,
        createdAt: serverTimestamp(),
      });
    },
    [uid]
  );

  const removeReference = useCallback(async (referenceId: string) => {
    await updateDoc(doc(db, 'references', referenceId), {
      status: 'removed',
    });
  }, []);

  const updateManualReference = useCallback(
    async (referenceId: string, data: ManualRefInput) => {
      const cleaned = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
      );
      const update: Record<string, unknown> = { ...cleaned };
      if (data.refPhone === undefined) update.refPhone = null;
      if (data.refEmail === undefined) update.refEmail = null;
      if (data.numberOfKids === undefined) update.numberOfKids = null;
      if (data.kidAges === undefined) update.kidAges = null;
      if (data.note === undefined) update.note = null;
      await updateDoc(doc(db, 'references', referenceId), update);
    },
    []
  );

  const publishReference = useCallback(async (referenceId: string) => {
    await updateDoc(doc(db, 'references', referenceId), {
      status: 'published',
      approvedAt: serverTimestamp(),
    });
  }, []);

  const unpublishReference = useCallback(async (referenceId: string) => {
    await updateDoc(doc(db, 'references', referenceId), {
      status: 'private',
    });
  }, []);

  return {
    manualRefs,
    familySubmittedRefs,
    loading,
    addManualReference,
    updateManualReference,
    removeReference,
    publishReference,
    unpublishReference,
  };
}
