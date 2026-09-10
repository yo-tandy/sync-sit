/** The three apps in the suite. */
export type SyncApp = 'sit' | 'study' | 'do';

/**
 * The suite-wide display order (issue #438).
 *
 * Fixed regardless of which app is "current" -- a bar that put the current
 * app first (sit: sit,study; study: study,sit) reordered itself on every
 * switch, which is the bug this constant fixes. Any host may omit an app
 * (sit and study omit `do` until decision 20/#304); `AppSwitchBar` filters
 * this list down to whichever of `current` + `siblings` are actually present
 * rather than reading it as "always render all three."
 */
export const APP_ORDER: readonly SyncApp[] = ['sit', 'study', 'do'];

/** Brand name as it is written, everywhere, in every language. Not translated. */
export const APP_NAME: Record<SyncApp, string> = {
  sit: 'sync/sit',
  study: 'sync/study',
  do: 'sync/do',
};

/**
 * Each app's accent as a LITERAL, not a token — deliberately.
 *
 * `--color-brand-600` resolves to whichever app is running: inside sit's
 * build it is red and there is no way to reach study's blue through it. The
 * shared account hub (#367) has to render a chip for every app on one neutral
 * page, so it needs all three values regardless of host.
 *
 * These are each theme's `--color-brand-600` (see theme/{sit,study,do}.css),
 * the stop chosen for AA contrast on white — do's is #0d8204 rather than its
 * icon green #16ad05 for exactly that reason. Keep them in step with the
 * themes; they are the same colour by intent, expressed twice because CSS
 * custom properties cannot be read across apps.
 */
export const APP_ACCENT: Record<SyncApp, string> = {
  sit: '#df1a30',
  study: '#094ad4',
  do: '#0d8204',
};

/**
 * A bar-weight brand mark: 48px (`sm`) and 96px (`md`), meant to be used
 * together as `src` + 2x `srcSet` for a ~24px slot -- never the 256px
 * originals, which cost ~100 KB each and are for About pages and install
 * prompts (see scripts/__tests__/brand-mark-weights.test.ts).
 */
export interface AppMark {
  sm: string;
  md: string;
}

/**
 * NO `BRAND_MARKS` HERE, ON PURPOSE (#422).
 *
 * This file used to export a `Record<SyncApp, AppMark>` built from six
 * static PNG imports, so every consumer could index it by app. That is
 * exactly the barrel shape d50e3f80 (#302) chose PNG subpath exports to
 * avoid: because the object imported all six variants at module scope, every
 * app that imported ANYTHING from this module shipped every app's bar-weight
 * marks in its dist, whether it rendered them or not -- verified, sit's and
 * study's builds each emitted the ~25 KB sync-do-mark-48/96 despite showing
 * no do tab (decision 20 gates that reachability until #304).
 *
 * The fix moves mark SELECTION back to the host: `AppSwitchBar`'s
 * `currentMark`/`siblings[].mark` and `AccountHome`'s `AccountSection.mark`
 * now take an `AppMark` from the caller, imported directly via
 * `@ejm/shared-ui/brand-marks/sync-{sit,study,do}-{48,96}.png`. Each app's
 * graph then holds only the marks its own call sites reference -- the same
 * property #302 established for the 256px originals, restored for the
 * bar-weight ones. `UnifiedLandingPage` (always shows all three, `do` muted)
 * takes a `marks: Record<SyncApp, AppMark>` prop for the same reason: the
 * eventual consuming app supplies the marks, this module does not.
 */
