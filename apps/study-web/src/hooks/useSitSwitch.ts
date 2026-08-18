import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { SIT_APP_URL, SIT_VERIFICATION_PATH } from '@/utils/appSwitch';

/**
 * The one cross-app switch idiom (study → sit): mint a one-time handoff code,
 * then navigate with the code in the URL FRAGMENT (#code=… — fragments never
 * reach servers or logs). Non-optimistic: `busy` holds until the mint
 * resolves; nothing navigates on failure, `failed` flips instead so the
 * caller can fall back to its non-switch UI.
 *
 * `destination` optionally deep-links a specific sit page after sign-in
 * (issue #129). It MUST be one of the compile-time constants in
 * utils/appSwitch — a relative sit path, never user input, never a full URL.
 * It rides as a `dest` fragment param, so sit's handoff page re-validates it
 * against a strict relative-path shape before honoring it.
 */
export function useSitSwitch(destination?: typeof SIT_VERIFICATION_PATH) {
  const { i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const switchToSit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const mint = httpsCallable<Record<string, never>, { code: string }>(
        functions,
        'createAppHandoffCode',
      );
      const res = await mint({});
      // Carry the CURRENT language across origins (i18n caches are
      // per-origin localStorage): the handoff page applies it on arrival.
      // Whitelisted at the source (mirrors the receiver's en|fr allowlist) —
      // i18n.language originates from localStorage/navigator via the detector.
      const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
      const dest = destination ? `&dest=${encodeURIComponent(destination)}` : '';
      window.location.assign(
        `${SIT_APP_URL}/handoff#code=${encodeURIComponent(res.data.code)}&lang=${encodeURIComponent(lang)}${dest}`,
      );
      // Stay busy: the browser is navigating away.
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return { busy, failed, switchToSit };
}
