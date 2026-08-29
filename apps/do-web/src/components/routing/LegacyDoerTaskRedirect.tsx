import { Navigate, useParams } from 'react-router';

/**
 * Redirect for the pre-namespace doer task paths (issue #296): `/tasks/:taskId`
 * and `/tasks/:taskId/offer`, which now live under `/doer/*`.
 *
 * The rest of the legacy paths are plain `<Navigate to="…" replace />` entries
 * in the route table — the repo's redirect idiom (see apps/web and
 * apps/study-web's `router.redirect.test.tsx`). These two cannot be, because
 * `Navigate`'s `to` is a literal path with no param interpolation: the redirect
 * has to read `:taskId` off the match to rebuild the destination, and reading a
 * match needs a component. Kept EAGER (three lines, no page payload) so a
 * deep link out of PR9's mail resolves without a chunk fetch.
 */
export function LegacyDoerTaskRedirect({ suffix = '' }: { suffix?: string }) {
  const { taskId } = useParams<{ taskId: string }>();
  return <Navigate to={`/doer/tasks/${taskId}${suffix}`} replace />;
}
