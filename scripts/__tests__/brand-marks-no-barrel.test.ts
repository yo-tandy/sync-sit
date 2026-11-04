import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Issue #422: `packages/shared-ui/src/lib/brandMarks.ts` used to be a barrel
 * -- one module importing all three apps' bar-weight PNGs into a single
 * `BRAND_MARKS: Record<SyncApp, ...>` -- and every consumer of it (sit's and
 * study's `AppSwitchBar`/`AppSwitchMenuItem`/`AccountHome`) pulled that whole
 * module in. Rollup does not tree-shake individual properties out of an
 * object literal, so sit's and study's dist each shipped sync-do's ~25 KB
 * mark even though decision 20 means neither ever renders a do tab.
 *
 * The fix moved mark SELECTION to the host: components take an `AppMark`
 * (or a `Record<SyncApp, AppMark>`) as a prop, and each app imports only the
 * marks its own call sites use via `@ejm/shared-ui/brand-marks/sync-<app>-
 * {48,96}.png` subpath exports (the same shape d50e3f80 / #302 chose for the
 * 256px originals, for the same reason).
 *
 * These are SOURCE-level pins, not a dist check: dist isn't guaranteed to
 * exist in CI, and grepping tracked source is exactly as sensitive to the
 * barrel coming back -- the regression IS a source-level import, and it was
 * invisible precisely because nothing failed until someone thought to build
 * and grep dist by hand. Mutation-verified (see comments below): each
 * assertion fails if the specific pattern it guards is reintroduced.
 */

const ROOT = resolve(__dirname, '../..');

/**
 * Every tracked `.ts`/`.tsx` file under `dir`, via `git ls-files` -- matches
 * this repo's other source-grep pins (see appSwitchBarHeight.test.ts) and
 * ignores build output, node_modules, and the stray .claude/worktrees
 * checked out alongside this one. NOT a `{ts,tsx}` brace pathspec: git's
 * pathspec globbing does not expand brace groups (verified against this
 * repo -- it silently matches zero files), so filtering the recursive
 * listing by extension in JS is the reliable version.
 */
function trackedTsFilesRecursive(dir: string): string[] {
  const out = execFileSync('git', ['ls-files', '--', dir], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
}

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

/* Comments are NOT readers/definitions (matches appSwitchBarHeight.test.ts's
   convention) -- every check below runs on stripped source, so prose
   DESCRIBING the old barrel (this file's own doc comments included) never
   satisfies a pin meant to catch the barrel's CODE coming back. */
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function code(relPath: string): string {
  return stripTs(read(relPath));
}

describe('brandMarks.ts carries no image imports (#422)', () => {
  it('imports no PNG asset at all', () => {
    const src = code('packages/shared-ui/src/lib/brandMarks.ts');
    // Mutation check: restoring `import sitSm from '../assets/sync-sit-mark-48.png';`
    // here trips this immediately.
    expect(src).not.toMatch(/from\s+['"].*\.png['"]/);
  });

  it('exports no BRAND_MARKS lookup', () => {
    const src = code('packages/shared-ui/src/lib/brandMarks.ts');
    // Mutation check: restoring `export const BRAND_MARKS = {...}` trips this.
    expect(src).not.toMatch(/\bBRAND_MARKS\b/);
  });
});

describe('no module in packages/shared-ui imports all three apps\' marks (#422)', () => {
  // The barrel shape is "one module, six PNG imports (three apps x two
  // sizes), or three apps x one size". Generalized: a module importing a
  // sync-sit AND a sync-study AND a sync-do mark (any size, any exact path)
  // is the barrel shape regardless of which file it lives in -- so this
  // scans every tracked shared-ui source file, not just brandMarks.ts by
  // name, and would catch the barrel resurrected under a different filename.
  const files = trackedTsFilesRecursive('packages/shared-ui/src').filter(
    (f) => !f.includes('__tests__') && !f.includes('.test.'),
  );

  it('finds shared-ui source files to scan (guards the discovery itself)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s does not import sit + study + do marks together', (file) => {
    const src = code(file);
    const importsSit = /from\s+['"](\.\.\/)*assets\/sync-sit-mark|brand-marks\/sync-sit/.test(src);
    const importsStudy = /from\s+['"](\.\.\/)*assets\/sync-study-mark|brand-marks\/sync-study/.test(
      src,
    );
    const importsDo = /from\s+['"](\.\.\/)*assets\/sync-do-mark|brand-marks\/sync-do/.test(src);
    expect(
      importsSit && importsStudy && importsDo,
      `${file} imports all three apps' marks -- this is the barrel shape #422 removed`,
    ).toBe(false);
  });
});

describe('sit and study never import a sync-do mark, in source (#422, decision 20)', () => {
  // Direct source grep, not a dist check (dist may not exist in CI): the
  // regression is a source-level import reaching a sync-do asset, whether
  // through the old barrel or a direct subpath import some future call site
  // adds by mistake. Either shape trips this the same way.
  // The sanctioned sit references: the unified /enroll landing page and the
  // choose-app screen each render a muted, non-clickable sync/do "coming soon"
  // tile (issue #435 items 2 and 5, decision 20 — identity, not reachability),
  // so they legitimately import the do marks. Anything else under apps/web/src that reaches a sync-do asset is
  // still a regression.
  const SIT_SANCTIONED_DO_MARK_HOSTS = [
    'apps/web/src/pages/public/EnrollLandingPage.tsx',
    'apps/web/src/pages/enrollment/ChooseAppPage.tsx',
  ];

  it('apps/web/src never references a sync-do mark outside the /enroll landing page', () => {
    const files = trackedTsFilesRecursive('apps/web/src');
    const sanctioned = files.filter((f) => SIT_SANCTIONED_DO_MARK_HOSTS.includes(f));
    // The exception must stay load-bearing: if the landing page stops
    // importing the mark, drop it from the list rather than let it rot.
    expect(sanctioned.map((f) => /brand-marks\/sync-do/.test(code(f)))).toEqual(sanctioned.map(() => true));
    const offenders = files
      .filter((f) => !SIT_SANCTIONED_DO_MARK_HOSTS.includes(f))
      .filter((f) => /sync-do-mark|brand-marks\/sync-do/.test(code(f)));
    // Mutation check: adding `import x from '@ejm/shared-ui/brand-marks/sync-do-48.png'`
    // to any file under apps/web/src trips this.
    expect(offenders, `sync-do mark referenced in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('apps/study-web/src never references a sync-do mark', () => {
    const files = trackedTsFilesRecursive('apps/study-web/src');
    const offenders = files.filter((f) => /sync-do-mark|brand-marks\/sync-do/.test(code(f)));
    expect(offenders, `sync-do mark referenced in: ${offenders.join(', ')}`).toEqual([]);
  });
});
