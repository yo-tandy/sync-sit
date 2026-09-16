import type { Language } from '@ejm/shared-core';

/**
 * A tiny typed bus for USER-initiated language changes (issue #512).
 *
 * i18next's own `languageChanged` event cannot say who changed the
 * language or why: `HandoffPage` switches it programmatically BEFORE
 * redeeming a cross-app code — while a different account may still be
 * signed in on this origin — and the i18n bootstrap fires it on load. A
 * listener that wrote `users/{uid}.language` on that event could stamp one
 * person's choice onto another person's doc. So the only writer-worthy
 * signal is the explicit one: `LanguageSelector` emits here after it
 * switches i18n, and `useSyncUserLanguage` subscribes here, not to i18next.
 */
type Listener = (language: Language) => void;
const listeners = new Set<Listener>();

export function emitUserLanguageChange(language: Language): void {
  for (const l of Array.from(listeners)) l(language);
}

/** Subscribe; returns the unsubscribe function. */
export function onUserLanguageChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toLanguage(lng: string): Language {
  return lng.startsWith('fr') ? 'fr' : 'en';
}
