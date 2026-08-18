import { useTranslation } from 'react-i18next';
import { Spinner } from '@ejm/shared-ui';
import sitLogo from '@/assets/sync-sit-logo.png';
import { useSitSwitch } from '@/hooks/useSitSwitch';

/**
 * Burger-menu entry that jumps to sync-sit without re-login via the shared
 * switch idiom (useSitSwitch): mints a one-time handoff code, then navigates
 * with the code in the URL FRAGMENT. Non-optimistic: the entry disables with
 * a spinner until the mint resolves; nothing navigates on failure. Shared by
 * the tutor AppBar and the FamilyAppBar.
 */
export function AppSwitchMenuItem() {
  const { t } = useTranslation();
  const { busy, failed, switchToSit } = useSitSwitch();

  return (
    <button
      type="button"
      onClick={() => void switchToSit()}
      disabled={busy}
      className="w-full text-left"
    >
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
