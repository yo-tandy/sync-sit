/**
 * Maps a Firebase Storage upload failure to an i18n key SUFFIX under the
 * "verification" namespace (e.g. `verification.uploadError` in sync-sit,
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
 */
export function uploadErrorKey(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  switch (code) {
    case 'storage/unauthorized':
      return 'uploadErrorUnauthorized';
    case 'storage/retry-limit-exceeded':
    case 'storage/canceled':
      return 'uploadErrorConnection';
    default:
      return 'uploadError';
  }
}
