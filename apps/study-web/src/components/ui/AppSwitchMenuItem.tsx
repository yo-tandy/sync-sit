import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Spinner } from '@ejm/shared-ui';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import { functions } from '@/config/firebase';
import { SIT_APP_URL } from '@/utils/appSwitch';

// Bar-weight mark, not the 256px original (#364): this slot is 20px, and the
// full mark costs ~100 KB to draw it. Imported directly, not through a
// shared-ui lookup (#422), so study's dist carries only this mark plus its
// own.
const sitMark = { sm: sitSm, md: sitMd };

/**
 * Burger-menu entry that jumps to sync-sit without re-login: mints a
 * one-time handoff code, then navigates with the code in the URL FRAGMENT
 * (#code=… — fragments never reach servers or logs). Non-optimistic: the
 * entry disables with a spinner until the mint resolves; nothing navigates
 * on failure. Shared by the tutor AppBar and the FamilyAppBar.
 *
 * Hidden below `md` BY THE TWO APP BARS since #365, because there the
 * app-switch bar is the entry point and a second one would let a code be
 * minted around the bar's whole-bar lock. At `md+` the bar is `md:hidden`
 * and this is the only switcher there is, until Q9 is answered (#417).
 * AdminInfoPage is unwrapped on purpose: it is a public route with no shell
 * and therefore no bar at any width.
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
    } catch (err) {
      console.error('[appSwitch] mint handoff code failed', err);
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
            <img
              src={sitMark.sm}
              srcSet={`${sitMark.sm} 1x, ${sitMark.md} 2x`}
              alt=""
              width={20}
              height={20}
              className="h-5 w-5 rounded object-contain"
            />
          )}
        </span>
        <span>{t('appSwitch.toSit')}</span>
      </div>
      {failed && <p className="px-4 pb-2 text-xs text-brand-600">{t('appSwitch.error')}</p>}
    </button>
  );
}
