import sitSm from '../assets/sync-sit-mark-48.png';
import sitMd from '../assets/sync-sit-mark-96.png';
import studySm from '../assets/sync-study-mark-48.png';
import studyMd from '../assets/sync-study-mark-96.png';
import doSm from '../assets/sync-do-mark-48.png';
import doMd from '../assets/sync-do-mark-96.png';

/** The three apps in the suite. */
export type SyncApp = 'sit' | 'study' | 'do';

/** Brand name as it is written, everywhere, in every language. Not translated. */
export const APP_NAME: Record<SyncApp, string> = {
  sit: 'sync/sit',
  study: 'sync/study',
  do: 'sync/do',
};

/**
 * THE one place bar-size brand marks are resolved.
 *
 * Every consumer goes through here rather than importing an asset directly,
 * so replacing the art is this file plus the assets and touches no app and no
 * component (#386 — the owner is supplying purpose-drawn icons; the current
 * variants are downscales of the 256px illustrations and are interim).
 *
 * `sm` is 48px and `md` is 96px, meant to be used together as src + 2x
 * srcSet for a ~24px slot. The 256px originals are deliberately NOT here:
 * they are for About pages and install prompts, and pulling one into a bar
 * costs ~100 KB per app on every screen (see
 * scripts/__tests__/brand-mark-weights.test.ts).
 *
 * Consumers, exhaustively: `AppSwitchBar` (24px tabs) and each app's
 * `AppSwitchMenuItem` (20px burger rows). The only remaining direct imports
 * of `@ejm/shared-ui/brand-marks/sync-*.png` are the three About pages,
 * which is what those exports are for.
 *
 * KNOWN COST, recorded rather than discovered later (#422). This module is
 * the barrel that d50e3f80 (#302) deliberately avoided: because it imports
 * all six variants statically, every app's dist gets every app's bar-weight
 * mark whether it renders one or not -- verified, sit's build emits
 * sync-do-mark-48/96 (~25 KB) and sit shows no do tab. #302 kept the 256px
 * marks as direct subpath exports precisely so each app's graph held only
 * what it used. That property does not survive an indexable
 * `Record<SyncApp, ...>`; getting it back means giving up the single lookup
 * this file exists to be. Accepted for now -- 25 KB against the ~294 KB the
 * bar-weight variants save, and #386's purpose-drawn glyphs change the
 * arithmetic again -- but it is a real reversal of a documented decision,
 * not an oversight.
 */
export const BRAND_MARKS: Record<SyncApp, { sm: string; md: string }> = {
  sit: { sm: sitSm, md: sitMd },
  study: { sm: studySm, md: studyMd },
  do: { sm: doSm, md: doMd },
};
