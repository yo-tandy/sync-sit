import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

/** Response shape of `doGetAssignedContact` (plan §6.4, decision 16). */
export interface AssignedContact {
  taskId: string;
  family: {
    familyName: string;
    address: string;
    parents: { firstName: string; lastName: string; email: string; phone?: string; whatsapp?: string }[];
  };
  doer: {
    firstName: string;
    lastName: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
    whatsapp?: string | null;
  };
}

export type AssignedContactState = 'loading' | 'ready' | 'grace_elapsed' | 'error';

/**
 * The decision-16 contact reveal, as ONE hook for both portals: fetched
 * LIVE on each view via `doGetAssignedContact` (nothing cached in
 * Firestore), with the §6.4 aftermath-grace refusal (`grace_elapsed`)
 * surfaced as its own state rather than an error. Extracted from PR7's
 * family AssignedTaskView so PR8's doer assigned view is the same code
 * path — the callable serves both sides' halves from one response.
 */
export function useAssignedContact(taskId: string): {
  contact: AssignedContact | null;
  contactState: AssignedContactState;
  retry: () => void;
} {
  const [contact, setContact] = useState<AssignedContact | null>(null);
  const [contactState, setContactState] = useState<AssignedContactState>('loading');
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let stale = false;
    // NOTE: contactState is set back to 'loading' by whoever schedules a
    // refetch (initial state, or the retry handler) — not synchronously
    // here (react-hooks/set-state-in-effect).
    const getContact = httpsCallable<{ taskId: string }, AssignedContact>(
      functions,
      'doGetAssignedContact',
    );
    getContact({ taskId })
      .then((res) => {
        if (stale) return;
        setContact(res.data);
        setContactState('ready');
      })
      .catch((err: unknown) => {
        if (stale) return;
        const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
        setContactState(reason === 'grace_elapsed' ? 'grace_elapsed' : 'error');
      });
    return () => {
      stale = true;
    };
  }, [taskId, retryTick]);

  return {
    contact,
    contactState,
    retry: () => {
      setContactState('loading');
      setRetryTick((n) => n + 1);
    },
  };
}
