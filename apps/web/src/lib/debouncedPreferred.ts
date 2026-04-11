import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

/**
 * Module-scoped map of pending favorite toggles.
 * Survives page navigation within the SPA — only cleared on full page refresh.
 *
 * When a user taps the heart, we wait 3 seconds before calling the backend.
 * If they tap again within 3 seconds (undo), we cancel the pending call entirely.
 */
const pendingToggles = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounced toggle for adding/removing a preferred babysitter.
 * Call this AFTER updating the local optimistic UI state.
 *
 * @param babysitterUserId - the babysitter to toggle
 * @param add - true to add, false to remove
 */
export function debouncedTogglePreferred(babysitterUserId: string, add: boolean): void {
  // If there's already a pending call for this babysitter, cancel it
  const existing = pendingToggles.get(babysitterUserId);
  if (existing != null) {
    clearTimeout(existing);
    pendingToggles.delete(babysitterUserId);
    return; // The user toggled back — no backend call needed
  }

  // Schedule the backend call after 3 seconds
  const timer = setTimeout(async () => {
    pendingToggles.delete(babysitterUserId);
    try {
      const fnName = add ? 'addPreferredBabysitter' : 'removePreferredBabysitter';
      const fn = httpsCallable(functions, fnName);
      await fn({ babysitterUserId });
    } catch {
      // Silent — the onSnapshot listener will reconcile if needed
    }
  }, 3000);

  pendingToggles.set(babysitterUserId, timer);
}
