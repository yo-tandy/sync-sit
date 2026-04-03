import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { PAST_VISIBILITY_DAYS } from '@ejm/shared';
import type { AppointmentDoc, ParentUser } from '@ejm/shared';

export function useFamilyAppointments() {
  const userDoc = useAuthStore((s) => s.userDoc);
  const familyId = (userDoc as ParentUser | null)?.familyId;
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<AppointmentDoc[]>([]);
  const [confirmed, setConfirmed] = useState<AppointmentDoc[]>([]);
  const [pastRecent, setPastRecent] = useState<AppointmentDoc[]>([]);
  const [rejectedRecent, setRejectedRecent] = useState<AppointmentDoc[]>([]);

  useEffect(() => {
    if (!familyId) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'appointments'),
      where('familyId', '==', familyId)
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
        const apt = d.data() as AppointmentDoc;
        // Hide declined appointments that have been resubmitted
        if ((apt as any).resubmitted) return;

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
    });

    return unsub;
  }, [familyId]);

  return { pending, confirmed, pastRecent, rejectedRecent, loading };
}
