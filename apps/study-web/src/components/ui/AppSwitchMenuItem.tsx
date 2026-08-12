import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Spinner } from '@ejm/shared-ui';
import sitLogo from '@/assets/sync-sit-logo.png';
import { functions } from '@/config/firebase';
import { SIT_APP_URL } from '@/utils/appSwitch';

/**
 * Burger-menu entry that jumps to sync-sit without re-login: mints a
 * one-time handoff code, then navigates with the code in the URL FRAGMENT
 * (#code=… — fragments never reach servers or logs). Non-optimistic: the
 * entry disables with a spinner until the mint resolves; nothing navigates
 * on failure. Shared by the tutor AppBar and the FamilyAppBar.
 */
export function AppSwitchMenuItem() {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleClick = async () => {
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
      window.location.assign(
        `${SIT_APP_URL}/handoff#code=${encodeURIComponent(res.data.code)}&lang=${encodeURIComponent(lang)}`,
      );
      // Stay busy: the browser is navigating away.
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} disabled={busy} className="w-full text-left">
      <div className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">
        <span className="text-gray-400">
          {busy ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <img src={sitLogo} alt="" className="h-5 w-5 rounded object-contain" />
          )}
        </span>
        <span>{t('appSwitch.toSit')}</span>
      </div>
      {failed && <p className="px-4 pb-2 text-xs text-brand-600">{t('appSwitch.error')}</p>}
    </button>
  );
}
