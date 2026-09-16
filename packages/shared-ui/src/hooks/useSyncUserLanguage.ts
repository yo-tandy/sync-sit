import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '@ejm/shared-core';

/**
 * Keep `users/{uid}.language` in step with the UI language (issue #512).
 *
 * `LanguageSelector` switches i18n and remembers the choice in
 * `localStorage`; nothing wrote it back to the user doc, so server-side
 * email copy (`notifyVerificationRejected`, guardian notices, …) kept using
 * the enrollment-time value forever. This hook listens to i18next's
 * `languageChanged` event and calls `write` for the signed-in user.
 *
 * Deliberately EVENT-driven, not state-driven: it never writes on mount or
 * on a plain sign-in (the doc is not silently overwritten with whatever the
 * browser happened to be set to), only after the language actually CHANGES
 * in this page session — a `LanguageSelector` click, or a cross-app handoff
 * applying the `lang` it was minted with. The handoff case fires BEFORE the
 * session exists (`HandoffPage` switches i18n, then redeems the code and
 * signs in), so a change seen while signed out is held as pending and
 * written once a user arrives; nothing pending → nothing written. One write
 * per (uid, language); a failed write clears that memo so the next change
 * retries.
 *
 * The host owns the Firestore handle, so it supplies `write` (an
 * `updateDoc` on its own `users/{uid}`); the rules already allow the owner
 * to update `language`.
 */
export function useSyncUserLanguage(
  uid: string | null,
  write: (language: Language) => Promise<void>,
): void {
  const { i18n } = useTranslation();
  const lastWritten = useRef<string | null>(null);
  // A change that happened while nobody was signed in (the handoff ordering
  // above). Consumed by the next sign-in; cleared by a later change.
  const pending = useRef<Language | null>(null);

  useEffect(() => {
    const flush = (language: Language) => {
      if (!uid) return;
      const key = `${uid}:${language}`;
      if (lastWritten.current === key) return;
      lastWritten.current = key;
      write(language).catch((err: unknown) => {
        lastWritten.current = null;
        console.warn('[i18n] user language sync failed', err);
      });
    };

    // A user just arrived (or the hook re-subscribed for them): replay the
    // change that was seen while signed out, if any — never the mere
    // current language.
    if (uid && pending.current) {
      const held = pending.current;
      pending.current = null;
      flush(held);
    }

    const onLanguageChanged = (lng: string) => {
      const language: Language = lng.startsWith('fr') ? 'fr' : 'en';
      if (!uid) {
        pending.current = language;
        return;
      }
      pending.current = null;
      flush(language);
    };
    i18n.on('languageChanged', onLanguageChanged);
    return () => {
      i18n.off('languageChanged', onLanguageChanged);
    };
  }, [uid, i18n, write]);
}
