import { useAuthStore } from '@/stores/authStore';
import { getDoerProfile } from '@ejm/do-core';

/**
 * One attempt to make the store prove the doer profile exists: swallow a
 * refresh (it rejects on an offline blip and no-ops on a cache miss --
 * enrollment has already succeeded, so neither may surface as failure),
 * re-check, back off 400ms (an immediate identical getDoc returns the same
 * miss), refresh once more, re-check. Port of study-web's
 * ensureTutorProfileLoaded (PR #257 round 6).
 *
 * @returns true when profiles.doer is readable in the settled store.
 */
export async function ensureDoerProfileLoaded(
  refreshUserDoc: () => Promise<void>,
): Promise<boolean> {
  await refreshUserDoc().catch(() => {});
  if (getDoerProfile(useAuthStore.getState().userDoc)) return true;
  await new Promise((r) => setTimeout(r, 400));
  await refreshUserDoc().catch(() => {});
  return Boolean(getDoerProfile(useAuthStore.getState().userDoc));
}
