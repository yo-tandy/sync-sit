import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';

/**
 * One attempt to make the store prove the tutor profile exists: swallow a
 * refresh (it rejects on an offline blip and no-ops on a cache miss --
 * enrollment has already succeeded, so neither may surface as failure),
 * re-check, back off 400ms (an immediate identical getDoc returns the same
 * miss), refresh once more, re-check. Extracted in PR #257 round 6 -- this
 * sequence had four hand-rolled copies across the enrollment surfaces.
 *
 * @returns true when profiles.tutor is readable in the settled store.
 */
export async function ensureTutorProfileLoaded(
  refreshUserDoc: () => Promise<void>,
): Promise<boolean> {
  await refreshUserDoc().catch(() => {});
  if (getTutorProfile(useAuthStore.getState().userDoc)) return true;
  await new Promise((r) => setTimeout(r, 400));
  await refreshUserDoc().catch(() => {});
  return Boolean(getTutorProfile(useAuthStore.getState().userDoc));
}
