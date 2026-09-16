import { httpsCallable } from 'firebase/functions';
import { CONSENT_VERSION } from '@ejm/shared-core';
import { ConsentGate } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';

/**
 * This app's binding of the shared re-consent gate (issue #488 decision 1).
 * Rendered by `AuthGuard` in place of the app when `needsReconsent(userDoc)`.
 *
 * `onAccept` sends the version THIS bundle presents (`CONSENT_VERSION`) --
 * the server refuses anything else -- then refreshes the member's doc, which
 * flips `needsReconsent` and unmounts the gate. `onSignOut` is the auth
 * store's own logout: declining means leaving, not browsing unaccepted.
 */
export function ConsentGateHost() {
  const logout = useAuthStore((s) => s.logout);
  const refreshUserDoc = useAuthStore((s) => s.refreshUserDoc);

  const acknowledge = httpsCallable<{ consentVersion: string }, { success: boolean }>(
    functions,
    'acknowledgeConsent',
  );

  const onAccept = async (consentVersion: string) => {
    await acknowledge({ consentVersion });
    await refreshUserDoc();
  };

  return <ConsentGate consentVersion={CONSENT_VERSION} onAccept={onAccept} onSignOut={logout} />;
}
