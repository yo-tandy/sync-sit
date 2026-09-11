import { notifyBlockedMinor } from './notifyBlockedMinor.js';

/**
 * Best-effort wrapper around `notifyBlockedMinor` (issue #421, option 1b): a
 * failing send must never leave a last-parent's minor un-blocked, so this is
 * the ONE place that swallows the notify call's own errors and turns them
 * into a log line rather than an aborted erasure -- the same contract every
 * other best-effort step in `admin/deleteUser.ts` already keeps (the
 * claim-release loop, the counterparty fan-out).
 *
 * A SEPARATE file from `notifyBlockedMinor.ts` and from `admin/deleteUser.ts`
 * deliberately: `admin/deleteUser.ts` pulls in the whole erasure's module
 * graph (doGdpr, studyGdpr, claimRelease, …), which is exactly what
 * `guardianNotifyCounts.test.ts`'s docblock explains you do NOT want to drag
 * into a test whose only interest is one function's error handling. Here,
 * mocking `./notifyBlockedMinor.js` alone is enough to pin the SWALLOW; its
 * own content (copy, localisation, channels) is pinned in
 * `__tests__/notifyBlockedMinor.test.ts`.
 */
export async function notifyBlockedMinorBestEffort(
  child: Parameters<typeof notifyBlockedMinor>[0],
  childUid: string,
  now: Date,
): Promise<void> {
  try {
    await notifyBlockedMinor(child, childUid, now);
  } catch (err) {
    console.error('[erasure] failed to notify blocked minor', { childUid, err });
  }
}
