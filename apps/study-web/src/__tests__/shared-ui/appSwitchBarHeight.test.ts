import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * The app-switch bar / shell height coupling (#419). Text-level pins in the
 * repo's recessTokens / themeWiring style, hosted here because shared-ui has
 * no test harness of its own (#348).
 *
 * THE BUG THIS GUARDS AGAINST: the bar ended with
 * `pb-[env(safe-area-inset-bottom)]`, so its rendered height was VARIABLE,
 * while every shell reserved a FIXED `pb-16`. At inset 0 the numbers happened
 * to agree; on a home-indicator phone in standalone mode the bar was ~34px
 * taller than the reservation and the bottom ~30px of every scrolled page sat
 * underneath it. A second, device-independent copy of the same mismatch: the
 * failed-switch alert rendered INSIDE the nav, growing the bar ~24px past any
 * reservation on any phone.
 *
 * THE FIX'S SHAPE, which is what these pins hold together: ONE token pair in
 * base.css. The bar sizes its row by `--spacing-app-switch-row` and pads only
 * the safe-area inset under it (its alert OVERLAYS instead of growing it —
 * pinned on the rendered component in apps/web's AppSwitchBar.test.tsx), so
 * its total height is exactly `--spacing-app-switch-bar` = row + inset. Every
 * shell that mounts the bar reserves `pb-app-switch-bar`, i.e. THE SAME
 * TOKEN. Neither side states a number, so the two cannot drift apart again —
 * unless one of these pins goes red first.
 *
 * jsdom applies no CSS and evaluates no env(), so nothing here (or anywhere
 * in this suite) can observe the rendered geometry; the issue says so itself.
 * These are structural pins on the wiring. The geometry needs a real
 * home-indicator device or Chrome device emulation to confirm.
 */

function repoRoot(dir: string): string {
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found');
    dir = parent;
  }
  return dir;
}

const ROOT = repoRoot(process.cwd());

/* Comments are NOT readers/definitions — every scan below runs on stripped
   source, so prose describing the contract never satisfies a pin on it. */
const stripCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const baseCss = stripCss(
  readFileSync(join(ROOT, 'packages/shared-ui/src/theme/base.css'), 'utf8'),
);
const barTsx = stripTs(
  readFileSync(join(ROOT, 'packages/shared-ui/src/components/AppSwitchBar.tsx'), 'utf8'),
);

/** The @theme block, extracted by brace depth: tokens outside it are plain
 *  custom properties Tailwind derives NO utilities from, so pb-app-switch-bar
 *  would silently stop existing as a class. */
function themeBlock(css: string): string {
  const start = css.indexOf('@theme {');
  expect(start, 'base.css lost its @theme block').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unbalanced @theme block');
}

describe('the token pair is defined, inside @theme (#419)', () => {
  const theme = themeBlock(baseCss);

  it('--spacing-app-switch-row is a fixed rem height', () => {
    // rem, not px: both the row and the reservation must scale together with
    // the root font size (17px on phones, base.css).
    expect(theme).toMatch(/--spacing-app-switch-row:\s*[\d.]+rem\s*;/);
  });

  it('--spacing-app-switch-bar is DERIVED: the row token plus the safe-area inset', () => {
    // The load-bearing pin. If either side of the calc becomes a literal, the
    // bar's height and the shells' reservation are two numbers again — the
    // exact drift #419 exists to close.
    expect(theme).toMatch(
      /--spacing-app-switch-bar:\s*calc\(\s*var\(--spacing-app-switch-row\)\s*\+\s*env\(safe-area-inset-bottom\)\s*\)\s*;/,
    );
  });
});

describe('the bar composes its height from the same tokens (#419)', () => {
  it('sizes its tab row with h-app-switch-row', () => {
    // The row token's reader. Without an explicit height the row is
    // content-sized (~61px today, more the day a label wraps) and the derived
    // bar token describes nothing.
    expect(barTsx).toMatch(/(?<![\w-])h-app-switch-row(?![\w-])/);
  });

  it('pads the safe-area inset under the row — the calc other half', () => {
    expect(barTsx).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('renders the failure alert out of flow, so it cannot grow the bar', () => {
    // The device-independent half of #419: in-flow, the alert added ~24px on
    // ANY phone. bottom-full only floats it above the nav when paired with
    // absolute; the rendered-element assertions live in apps/web's
    // AppSwitchBar.test.tsx, this is the source-level half.
    expect(barTsx).toMatch(/(?<![\w-])bottom-full(?![\w-])/);
    expect(barTsx).toMatch(/(?<![\w-])absolute(?![\w-])/);
  });
});

describe('every shell that mounts the bar reserves the token (#419)', () => {
  /* Discovery, not a hand-audited list of call sites: walk every layout file
     in the three apps and find the ones rendering <AppSwitchBarHost. A future
     shell (the sync-ici shared shell is already planned) that mounts the bar
     is discovered the day it lands and graded by the it.each below — the
     equality pin is what makes the discovery itself un-rottable. */
  const LAYOUT_ROOTS = [
    'apps/web/src/layouts',
    'apps/study-web/src/layouts',
    'apps/do-web/src/layouts',
  ];

  const layoutFiles = LAYOUT_ROOTS.flatMap((root) =>
    readdirSync(join(ROOT, root), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.includes('.test.'))
      .map((e) => relative(ROOT, join(ROOT, root, e.name))),
  );

  const consumers = layoutFiles
    .filter((f) => stripTs(readFileSync(join(ROOT, f), 'utf8')).includes('<AppSwitchBarHost'))
    .sort();

  it('finds the seven mounting shells (guards the discovery itself)', () => {
    // AccountLayout IS one of them: "sit's admin shell renders no bar" is
    // AdminLayout, and the issue's list of six predates the account hub. An
    // eighth entry here is not a failure to silence — it is a new shell,
    // which must reserve the token like the rest; add it and move on.
    expect(consumers).toEqual([
      'apps/do-web/src/layouts/DoerLayout.tsx',
      'apps/do-web/src/layouts/FamilyLayout.tsx',
      'apps/study-web/src/layouts/FamilyLayout.tsx',
      'apps/study-web/src/layouts/TutorLayout.tsx',
      'apps/web/src/layouts/AccountLayout.tsx',
      'apps/web/src/layouts/BabysitterLayout.tsx',
      'apps/web/src/layouts/FamilyLayout.tsx',
    ]);
  });

  it.each(consumers)('%s reserves pb-app-switch-bar, lifting at md', (file) => {
    const src = stripTs(readFileSync(join(ROOT, file), 'utf8'));
    expect(src).toMatch(/(?<![\w-])pb-app-switch-bar(?![\w-])/);
    expect(src).toMatch(/(?<![\w-])md:pb-0(?![\w-])/);
  });

  it.each(consumers)('%s carries no fixed pb-16 — the number the token replaced', (file) => {
    const src = stripTs(readFileSync(join(ROOT, file), 'utf8'));
    expect(
      src,
      'pb-16 is the pre-#419 fixed reservation; alongside the token it is dead weight, instead of it the bug is back',
    ).not.toMatch(/(?<![\w-])pb-16(?![\w-])/);
  });
});
