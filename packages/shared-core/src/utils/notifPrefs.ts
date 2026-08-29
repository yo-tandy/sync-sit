import {
  DEFAULT_APP_NOTIF_PREFS,
  DEFAULT_SHARED_NOTIF_PREFS,
  type AppNotifCategory,
  type NotifAppScope,
  type NotifCategory,
  type NotifChannels,
  type NotifScope,
  type SharedNotifCategory,
  type StoredNotifPrefs,
} from '../types/common.js';

/**
 * THE ONE READER of `users/{uid}.notifPrefs` (issue #369).
 *
 * Every sender in every codebase resolves a preference through this function
 * rather than indexing the stored object, for three reasons:
 *
 * 1. the shape is app-scoped now (`{ shared, sit, study, do }`) and the
 *    scope of a category is a fact about the category, not about the caller;
 * 2. the TRANSITIONAL read of the pre-#369 flat shape lives in exactly one
 *    place, so removing it later is a one-line deletion, not a sweep;
 * 3. the FAIL DIRECTION is decided once, deliberately, instead of being
 *    re-improvised as `?.email !== false` at forty call sites.
 */

/**
 * shared-core compiles against `lib: ES2022` only — no DOM, no @types/node —
 * because it is imported by two functions runtimes and three browsers alike.
 * Reach for the host's console through `globalThis` rather than assuming one.
 */
function warnOnce(message: string): void {
  const host = globalThis as { console?: { warn?: (m: string) => void } };
  host.console?.warn?.(message);
}

const SHARED_CATEGORIES: readonly SharedNotifCategory[] = ['reminders', 'references'];
const APP_CATEGORIES: readonly AppNotifCategory[] = ['newRequest', 'confirmed', 'cancelled'];
const APP_SCOPES: readonly NotifAppScope[] = ['sit', 'study', 'do'];

/** All notification-preference categories, in display order. */
export const NOTIF_CATEGORIES: readonly NotifCategory[] = [
  ...APP_CATEGORIES,
  ...SHARED_CATEGORIES,
];

/**
 * Which block a category is stored in. `null` for a value that is not a
 * category at all — the runtime guard for data arriving from Firestore or
 * from JavaScript call sites the compiler never checked.
 */
export function notifCategoryScope(category: string): 'shared' | 'app' | null {
  if ((SHARED_CATEGORIES as readonly string[]).includes(category)) return 'shared';
  if ((APP_CATEGORIES as readonly string[]).includes(category)) return 'app';
  return null;
}

/** Is this a scope a `NotifPrefs` document can carry a block for? */
export function isNotifAppScope(app: string): app is NotifAppScope {
  return (APP_SCOPES as readonly string[]).includes(app);
}

/**
 * FAIL DIRECTION, decided once and stated here because it is the whole point
 * of routing every reader through this function.
 *
 * - **A known category with nothing stored resolves to the PRODUCT DEFAULT
 *   for that category** — never to a blanket "notify". The defaults are
 *   per-category on purpose (`reminders.email` is false), so a user who has
 *   never touched the screen and a doc written before the field existed must
 *   land in the same place a fresh signup does. A partially-stored category
 *   is merged channel-by-channel over that default for the same reason: a
 *   doc carrying `{ email: false }` and nothing else must not lose push.
 *
 * - **An UNKNOWN category or an unknown app scope resolves to
 *   `{ push: false, email: false }`, loudly.** This is the deliberate
 *   fail-CLOSED half. An unknown key cannot come from a user choice — it can
 *   only come from a code/schema mismatch — and the user has, by definition,
 *   never been shown a toggle governing it. Emailing someone on the strength
 *   of a preference they were never offered is precisely the consent problem
 *   issue #369 is about, so the send is dropped and the mismatch is logged
 *   where the operator will see it.
 *
 * - **It warns rather than throws** because every caller is a POST-COMMIT
 *   sender (the invariant `apps/functions/src/do/notify.ts` documents): the
 *   transaction is already committed and the promise to the client already
 *   made, so a throw either gets swallowed by the surrounding
 *   `notifyDoSafely`/try-catch and tells nobody, or escapes a bare loop and
 *   silences that notification's OTHER recipients. A loud, counted no-send
 *   is the strictly more useful failure.
 */
export function resolveNotifPref(
  prefs: StoredNotifPrefs | null | undefined,
  app: NotifAppScope,
  category: NotifCategory,
): NotifChannels {
  const scope = notifCategoryScope(category);
  if (scope === null || !isNotifAppScope(app)) {
    warnOnce(
      `[notifPrefs] unknown preference (app=${String(app)}, category=${String(category)}) — ` +
        'sending nothing. This is a code/schema mismatch, not a user choice.',
    );
    return { push: false, email: false };
  }

  const fallback: NotifChannels =
    scope === 'shared'
      ? DEFAULT_SHARED_NOTIF_PREFS[category as SharedNotifCategory]
      : DEFAULT_APP_NOTIF_PREFS[category as AppNotifCategory];

  const block = scope === 'shared' ? prefs?.shared : prefs?.[app];
  const stored = (block as Record<string, unknown> | undefined)?.[category];

  // TRANSITIONAL (#369): un-backfilled docs still carry the flat shape. The
  // legacy value is consulted ONLY when the scoped block has said nothing, so
  // a migrated doc is never overridden by the stale flat copy left beside it.
  // Removed with `LegacyNotifPrefs` once the backfill has run in prod.
  const legacy = isChannels(stored) ? undefined : (prefs as Record<string, unknown> | undefined)?.[category];

  return mergeChannels(isChannels(stored) ? stored : legacy, fallback);
}

function isChannels(value: unknown): value is Partial<NotifChannels> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeChannels(stored: unknown, fallback: NotifChannels): NotifChannels {
  if (!isChannels(stored)) return { ...fallback };
  return {
    push: typeof stored.push === 'boolean' ? stored.push : fallback.push,
    email: typeof stored.email === 'boolean' ? stored.email : fallback.email,
  };
}

/**
 * The dotted Firestore path a UI writes for one toggle. Surfaces must write
 * the narrowest path they changed — a whole-object `notifPrefs` write would
 * clobber blocks a sibling app wrote after the page mounted (the issue #186
 * fix, preserved through this reshape).
 */
export function notifPrefPath(
  app: NotifAppScope,
  category: NotifCategory,
  channel?: keyof NotifChannels,
): string {
  const block = notifCategoryScope(category) === 'shared' ? 'shared' : app;
  return channel
    ? `notifPrefs.${block}.${category}.${channel}`
    : `notifPrefs.${block}.${category}`;
}

/** The minimum a user doc must expose for the block-visibility rule. */
export interface NotifScopeUser {
  profiles?: {
    babysitter?: unknown;
    tutor?: unknown;
    doer?: unknown;
    parent?: unknown;
  };
}

/**
 * THE RENDERING RULE (issue #369): one `shared` block, plus a block per
 * profile the user actually holds. A surface must render only these.
 *
 * Provider profiles name their app directly: `babysitter` -> sit,
 * `tutor` -> study, `doer` -> do.
 *
 * `profiles.parent` is app-agnostic BY DESIGN (one `familyId` per person
 * across the three apps — see types/user.ts), so it cannot name an app on its
 * own. It is resolved from the family surfaces that actually exist:
 * apps/web and apps/study-web both ship a family Account page that has always
 * written these preferences, so a parent holds `sit` and `study`. apps/do-web
 * ships NO family account or settings page and sync-do has no family profile
 * slot at all (plan §3.3 — `profiles.doer` is do's only slot), so a parent's
 * presence in sync-do is not something the user doc can currently express.
 * A parent therefore does NOT get the `do` block — which is exactly the
 * defect issue #369 opens with: a sit-only parent must never be shown "board
 * digest" and "offer received" toggles for an app they have never opened.
 *
 * The residual is named, not hidden: a hiring parent who does use sync/do
 * cannot yet TUNE their do preferences (their delivery is unaffected — the
 * senders resolve `do` to the product defaults). Closing that needs a do-side
 * family marker on the user doc, which is sync-do's to add; tracked as the
 * follow-up on issue #369.
 */
export function notifPrefScopesForUser(user: NotifScopeUser | null | undefined): NotifScope[] {
  const profiles = user?.profiles;
  const scopes: NotifScope[] = ['shared'];
  if (profiles?.babysitter || profiles?.parent) scopes.push('sit');
  if (profiles?.tutor || profiles?.parent) scopes.push('study');
  if (profiles?.doer) scopes.push('do');
  return scopes;
}

/** Does this user hold the given block? (`notifPrefScopesForUser`, asked one at a time.) */
export function hasNotifPrefScope(
  user: NotifScopeUser | null | undefined,
  scope: NotifScope,
): boolean {
  return notifPrefScopesForUser(user).includes(scope);
}

/** One toggle row on a notification-preferences surface. */
export interface NotifPrefRow {
  scope: NotifScope;
  category: NotifCategory;
}

/**
 * Exactly the rows a notification-preferences surface may render for this
 * user: the shared block first, then one block per profile they hold, in
 * `notifPrefScopesForUser` order. This is the rendering rule of issue #369
 * made executable — a per-app Account page filters it down to its own scope,
 * and the shared account hub (#367) renders it whole.
 */
export function notifPrefRowsForUser(user: NotifScopeUser | null | undefined): NotifPrefRow[] {
  return notifPrefScopesForUser(user).flatMap((scope) =>
    (scope === 'shared' ? SHARED_CATEGORIES : APP_CATEGORIES).map((category) => ({
      scope,
      category: category as NotifCategory,
    })),
  );
}

/**
 * Resolve a whole set of categories at once, for a surface that renders them
 * together. Same resolution — and therefore the same answer — as the senders'
 * per-category reads, which is the point: the toggle a user sees ON must be
 * one the server will act on.
 */
export function resolveNotifPrefsFor(
  prefs: StoredNotifPrefs | null | undefined,
  app: NotifAppScope,
  categories: readonly NotifCategory[],
): Record<string, NotifChannels> {
  const out: Record<string, NotifChannels> = {};
  for (const category of categories) out[category] = resolveNotifPref(prefs, app, category);
  return out;
}
