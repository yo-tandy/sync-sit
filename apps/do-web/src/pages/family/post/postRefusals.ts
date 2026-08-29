/**
 * `doPostTask` posting-gate refusal → copy-key mapping (issue #333).
 *
 * `loadVerifiedFamilyCaller` throws `permission-denied` for three unrelated
 * situations, and now says which one in `details.reason`. Before that the
 * wizard could only print the honest union of all three ("an active parent
 * account with a verified family"), which reads as an accusation of whichever
 * two things are actually fine.
 *
 * Kept beside `PostTaskPage` rather than inside it — the `offerRefusals.ts`
 * precedent: mixing a component export with plain constants defeats Fast
 * Refresh (react-refresh/only-export-components).
 */
export type PostDenial = 'account_not_active' | 'not_parent' | 'family_not_verified';

export const POST_DENIAL_KEYS: Record<PostDenial, string> = {
  account_not_active: 'family.post.deniedNotActive',
  not_parent: 'family.post.deniedNotParent',
  family_not_verified: 'family.post.deniedNotVerified',
};

export function isPostDenial(reason: unknown): reason is PostDenial {
  return typeof reason === 'string' && reason in POST_DENIAL_KEYS;
}

/**
 * The union copy is NOT dead code now that the three cases are named: it is
 * what a `permission-denied` with no (or an unrecognised) reason still gets.
 * That happens whenever a browser holding this bundle talks to a functions
 * deployment older than it — the ordinary state of the world for the minutes
 * between the two deploys — and again the first time a fourth case is added
 * server-side. Degrading to the union is honest; degrading to "please try
 * again" would not be.
 */
export const POST_DENIED_FALLBACK_KEY = 'family.post.postDeniedError';

/** Every way the review step can fail to publish. */
export type PublishErrorKey = 'generic' | 'cap' | 'denied' | PostDenial | null;

/** The copy key a publish failure renders. */
export function publishErrorCopyKey(error: Exclude<PublishErrorKey, null>): string {
  if (error === 'cap') return 'family.post.capError';
  if (error === 'denied') return POST_DENIED_FALLBACK_KEY;
  if (isPostDenial(error)) return POST_DENIAL_KEYS[error];
  return 'family.post.publishError';
}
