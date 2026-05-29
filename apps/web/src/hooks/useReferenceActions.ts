import { useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

const submitFamilyEndorsementFn = httpsCallable<
  {
    babysitterUserId: string;
    appointmentId: string;
    referenceText: string;
    refName: string;
    refPhone?: string | null;
    refWhatsapp?: string | null;
    refEmail?: string | null;
    numberOfKids?: number | null;
    kidAges?: number[] | null;
  },
  { referenceId: string }
>(functions, 'submitFamilyEndorsement');

const acceptFamilyEndorsementFn = httpsCallable<
  { referenceId: string },
  { ok: boolean }
>(functions, 'acceptFamilyEndorsement');

const publishManualReferenceFn = httpsCallable<
  { referenceId: string },
  { ok: boolean }
>(functions, 'publishManualReference');

export function useReferenceActions() {
  const submitFamilyEndorsement = useCallback(
    async (input: Parameters<typeof submitFamilyEndorsementFn>[0]) => {
      const result = await submitFamilyEndorsementFn(input);
      return result.data;
    },
    []
  );

  const acceptFamilyEndorsement = useCallback(async (referenceId: string) => {
    await acceptFamilyEndorsementFn({ referenceId });
  }, []);

  const publishManualReference = useCallback(async (referenceId: string) => {
    await publishManualReferenceFn({ referenceId });
  }, []);

  return { submitFamilyEndorsement, acceptFamilyEndorsement, publishManualReference };
}
