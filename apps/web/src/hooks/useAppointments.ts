import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { PAST_VISIBILITY_DAYS } from '@ejm/shared';
import type { AppointmentDoc } from '@ejm/shared';

export function useAppointments() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  // Initial loading state derives from uid: if there is no signed-in user
  // we have nothing to fetch, so we are already "done" loading. The
  // snapshot callback below flips this back to false once Firestore has
  // returned the first page of data for a valid uid.
  const [loading, setLoading] = useState<boolean>(Boolean(uid));
  const [pending, setPending] = useState<AppointmentDoc[]>([]);
  const [confirmed, setConfirmed] = useState<AppointmentDoc[]>([]);
  const [pastRecent, setPastRecent] = useState<AppointmentDoc[]>([]);
  const [rejectedRecent, setRejectedRecent] = useState<AppointmentDoc[]>([]);

  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(db, 'appointments'),
      where('babysitterUserId', '==', uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - PAST_VISIBILITY_DAYS);

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
          // For one-time: check if endTime has passed (not just the date)
          if (apt.date) {
            const endTimeStr = apt.endTime || '23:59';
            const aptEnd = new Date(`${apt.date}T${endTimeStr}:00`);
            if (aptEnd < now) {
              const aptDate = new Date(apt.date);
              if (aptDate >= cutoff) _past.push(apt);
            } else {
              _confirmed.push(apt);
            }
          } else {
            // Recurring — always show as confirmed
            _confirmed.push(apt);
          }
        } else if (apt.status === 'rejected' || apt.status === 'cancelled') {
          const updatedAt = apt.updatedAt?.toDate?.() || new Date(0);
          if (updatedAt >= cutoff) {
            _rejected.push(apt);
          }
        }
      });

      setPending(_pending);
      setConfirmed(_confirmed);
      setPastRecent(_past);
      setRejectedRecent(_rejected);
      setLoading(false);
    });

    return unsub;
  }, [uid]);

  return { pending, confirmed, pastRecent, rejectedRecent, loading };
}
