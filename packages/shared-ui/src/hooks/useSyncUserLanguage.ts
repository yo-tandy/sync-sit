import { useEffect, useRef } from 'react';
import type { Language } from '@ejm/shared-core';
import { onUserLanguageChange } from '../i18n/userLanguage.js';

/**
 * Keep `users/{uid}.language` in step with the language the USER picks
 * (issue #512).
 *
 * `LanguageSelector` switches i18n and remembers the choice in
 * `localStorage`; nothing wrote it back to the user doc, so server-side
 * email copy (`notifyVerificationRejected`, guardian notices, …) kept using
 * the enrollment-time value forever. This hook subscribes to the explicit
 * user-language bus that `LanguageSelector` emits on and calls `write` for
 * the user signed in at that moment.
 *
 * What it deliberately does NOT react to: i18next's `languageChanged`. That
 * event also fires on bootstrap and when `HandoffPage` applies the `lang` a
 * cross-app code was minted with — before the code is redeemed, possibly
 * while a DIFFERENT account is still signed in on this origin — so keying
 * a write off it could stamp one person's language onto another person's
 * doc (#518 review). A handoff's language needs no write anyway: it is the
 * source app's UI language, which the source app's own selector already
 * synced to the same shared user doc.
 *
 * Never writes on mount or sign-in; one write per (uid, language); a failed
 * write clears that memo so the next click retries. The host owns the
 * Firestore handle and supplies `write` (an `updateDoc` on its own
 * `users/{uid}`); the rules already allow the owner to update `language`.
 */
export function useSyncUserLanguage(
  uid: string | null,
  write: (language: Language) => Promise<void>,
): void {
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return onUserLanguageChange((language) => {
      const key = `${uid}:${language}`;
      if (lastWritten.current === key) return;
      lastWritten.current = key;
      write(language).catch((err: unknown) => {
        lastWritten.current = null;
        console.warn('[i18n] user language sync failed', err);
      });
    });
  }, [uid, write]);
}
