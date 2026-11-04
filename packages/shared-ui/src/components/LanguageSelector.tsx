import { useTranslation } from 'react-i18next';
import type { Language } from '@ejm/shared-core';
import { emitUserLanguageChange } from '../i18n/userLanguage.js';

export function LanguageSelector({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();

  const handleChange = (lang: Language) => {
    i18n.changeLanguage(lang);
    // The one USER-initiated language signal: `useSyncUserLanguage` writes
    // it to the signed-in user's doc (issue #512). Programmatic switches
    // (bootstrap, HandoffPage) go through i18n only and never write.
    emitUserLanguageChange(lang);
    // Remembering the choice locally is best-effort (issue #522): a runtime
    // without `localStorage` (Node 26 without --localstorage-file, a
    // hardened browser profile) or one that throws on write (private mode,
    // quota) must not take the switch and the signal above down with it —
    // which is also why they run first.
    try {
      globalThis.localStorage?.setItem('ejm_language', lang);
    } catch {
      // Swallowed by design — see above.
    }
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => handleChange('en')}
        className={`rounded-lg border-[1.5px] px-3 py-1.5 text-sm font-medium transition-colors ${
          i18n.language === 'en'
            ? 'border-brand-600 bg-brand-50 text-brand-600'
            : 'border-gray-300 text-gray-700 hover:border-gray-400'
        }`}
      >
        English
      </button>
      <button
        type="button"
        onClick={() => handleChange('fr')}
        className={`rounded-lg border-[1.5px] px-3 py-1.5 text-sm font-medium transition-colors ${
          i18n.language?.startsWith('fr')
            ? 'border-brand-600 bg-brand-50 text-brand-600'
            : 'border-gray-300 text-gray-700 hover:border-gray-400'
        }`}
      >
        Français
      </button>
    </div>
  );
}
