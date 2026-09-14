/**
 * Maps an upload failure to an i18n key SUFFIX under the "verification"
 * namespace (e.g. `verification.uploadError` in sync-sit,
 * `family.verification.uploadError` in sync-study — the namespace prefix
 * differs per app, so callers prepend their own, matching how they already
 * build sibling keys like `verification.fileTooLarge`).
 *
 * A bare `catch {}` around verification document uploads threw away the
 * error entirely (#448): every failure — including a Storage rules denial
 * (`storage/unauthorized`) — collapsed into one generic string, which
 * directly extended the #446 production outage because there was nothing
 * to diagnose from. This keeps the user-facing copy non-technical while
 * still distinguishing the actionable codes; callers are expected to log
 * the raw error (e.g. `console.error`) separately for diagnosis.
 *
 * Two code families feed this, from the two upload shapes in the repo:
 * - `storage/*` — a raw Firebase Storage client-SDK write (VerificationPage:
 *   direct `uploadBytes`, denied/retried by storage.rules or the network).
 * - `functions/*` — a Firebase Functions `httpsCallable` rejection (issue
 *   #471's signed-URL flow: FamilySettingsPage calls a callable BEFORE
 *   ever touching Storage, so a membership/auth failure surfaces as a
 *   Functions error code, not a Storage one — the web SDK prefixes callable
 *   error codes with `functions/`, e.g. `functions/permission-denied`).
 * A signed-URL `fetch` PUT failure carries neither prefix (a bare `Error`,
 * or none at all for a network-level throw) — callers of THIS flow are
 * expected to attach `code: 'upload/network'` to whatever they throw for a
 * failed/rejected PUT (see FamilySettingsPage's `uploadFamilyPhoto`), which
 * this function also recognizes.
 */
export function uploadErrorKey(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  switch (code) {
    case 'storage/unauthorized':
    case 'functions/permission-denied':
    case 'functions/unauthenticated':
      return 'uploadErrorUnauthorized';
    case 'storage/retry-limit-exceeded':
    case 'storage/canceled':
    case 'functions/unavailable':
    case 'functions/deadline-exceeded':
    case 'upload/network':
      return 'uploadErrorConnection';
    default:
      return 'uploadError';
  }
}
