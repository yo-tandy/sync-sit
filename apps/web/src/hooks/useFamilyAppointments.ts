import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { PAST_VISIBILITY_DAYS } from '@ejm/sit-core';
import { getClientConfigValue } from '@/lib/adminConfigClient';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';
import type { AppointmentDoc } from '@ejm/sit-core';
import { getParentProfile } from '@ejm/sit-core';

export function useFamilyAppointments() {
  const userDoc = useAuthStore((s) => s.userDoc);
  const familyId = getParentProfile(userDoc)?.familyId;
  // Initial loading state derives from familyId: if there is no signed-in
  // parent we have nothing to fetch, so we are already "done" loading.
  // The snapshot callback below flips this back to false once Firestore
  // has returned the first page of data for a valid familyId.
  const [loading, setLoading] = useState<boolean>(Boolean(familyId));
  const [pending, setPending] = useState<AppointmentDoc[]>([]);
  const [confirmed, setConfirmed] = useState<AppointmentDoc[]>([]);
  const [pastRecent, setPastRecent] = useState<AppointmentDoc[]>([]);
  const [rejectedRecent, setRejectedRecent] = useState<AppointmentDoc[]>([]);

  useEffect(() => {
    if (!familyId) return;

    const q = query(
      collection(db, 'appointments'),
      where('familyId', '==', familyId)
    );

    // Admin-configurable since issue #250, applied WITHOUT gating first
    // paint (round-2 review: resolve-before-subscribe added a serial round
    // trip in front of the cache-served snapshot): subscribe immediately
    // with the code default, remember the latest snapshot, and re-bucket
    // it the moment the configured value arrives -- which also covers the
    // quiet dashboard whose only snapshot fired before the config resolved
    // (the round-1 defect).
    let cancelled = false;
    let pastVisibilityDays = PAST_VISIBILITY_DAYS;
    let latestSnap: QuerySnapshot | null = null;
    void getClientConfigValue(
      'pastVisibilityDays',
      PAST_VISIBILITY_DAYS,
      ADMIN_CONFIG_DEFS.pastVisibilityDays,
    )
      .then((v) => {
        if (cancelled || v === pastVisibilityDays) return;
        pastVisibilityDays = v;
        if (latestSnap) bucket(latestSnap);
      })
      .catch(() => {});
    const unsub = onSnapshot(q, (snap) => {
      latestSnap = snap;
      bucket(snap);
    });
    function bucket(snap: QuerySnapshot) {
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - pastVisibilityDays);

      const _pending: AppointmentDoc[] = [];
      const _confirmed: AppointmentDoc[] = [];
      const _past: AppointmentDoc[] = [];
      const _rejected: AppointmentDoc[] = [];

      snap.docs.forEach((d) => {
        const apt = d.data() as AppointmentDoc & { resubmitted?: boolean };
        // Hide declined appointments that have been resubmitted
        if (apt.resubmitted) return;

        if (apt.status === 'pending') {
          _pending.push(apt);
        } else if (apt.status === 'confirmed') {
          if (apt.date) {
            // Use endTime to determine if appointment is past (default to 23:59 if no endTime)
            const endTimeStr = apt.endTime || '23:59';
            const aptEnd = new Date(`${apt.date}T${endTimeStr}:00`);
            if (aptEnd < now) {
              const aptDate = new Date(apt.date);
              if (aptDate >= cutoff) _past.push(apt);
            } else {
              _confirmed.push(apt);
            }
          } else {
            _confirmed.push(apt);
          }
        } else if (apt.status === 'rejected' || apt.status === 'cancelled') {
          const updatedAt = apt.updatedAt?.toDate?.() || new Date(0);
          if (updatedAt >= cutoff) _rejected.push(apt);
        }
      });

      setPending(_pending);
      setConfirmed(_confirmed);
      setPastRecent(_past);
      setRejectedRecent(_rejected);
      setLoading(false);
    }

    return () => {
      cancelled = true;
      unsub();
    };
  }, [familyId]);

  return { pending, confirmed, pastRecent, rejectedRecent, loading };
}
