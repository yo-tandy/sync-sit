import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Regression guards for the Recess visual pass (issue #366, PR #395 review
 * round 1). Text-level pins in the repo's themeWiring / brandTokens /
 * focusVisibleRule style, and for the same reason those exist: CSS wiring
 * rots silently and only review catches it.
 *
 * The PR's own thesis is that a design token with NO READER ships nothing --
 * `--font-sans` named a font no one imported, `--shadow-card` existed while
 * `Card` inlined an arbitrary shadow, and every authed shell was `bg-white`
 * so no ground could appear. Review then found the PR reproducing that shape
 * with four more unread tokens. So the central pin here is generic rather
 * than a list of today's mistakes: EVERY semantic token the pass introduces
 * must have a real reader, which fails the day a fifth one is added and
 * forgotten.
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
const SHARED_UI = join(ROOT, 'packages/shared-ui');
const THEME = join(SHARED_UI, 'src/theme');

/* Comments are NOT readers. Everything below scans comment-stripped source,
   because a suite whose job is to find tokens nothing reads would otherwise
   be satisfied by prose: base.css spells out the emitted `--tw-shadow` rule
   in a comment, and Card/Badge name their own classes in theirs. Stripping
   is what makes these pins fail when the code changes and the comment does
   not. */
const stripCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const BRAND_FILES = ['sit.css', 'study.css', 'do.css'];
const baseCss = stripCss(readFileSync(join(THEME, 'base.css'), 'utf8'));
const themeCss = [
  baseCss,
  ...BRAND_FILES.map((f) => stripCss(readFileSync(join(THEME, f), 'utf8'))),
].join('\n');

/* Every hand-written .tsx across shared-ui and all three apps -- the full set
   of places a Tailwind utility can read a token from. __tests__ are excluded
   so a test naming a class never counts as that class being used. */
const SRC_ROOTS = [
  'packages/shared-ui/src',
  'apps/web/src',
  'apps/study-web/src',
  'apps/do-web/src',
];
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [p] : [];
  });
}
const markup = new Map(
  SRC_ROOTS.flatMap((r) => walk(join(ROOT, r))).map((f) => [
    relative(ROOT, f),
    stripTs(readFileSync(f, 'utf8')),
  ]),
);

/* Tailwind v4 derives utility names from the token's namespace, so a reader
   is `<prefix>-<name>` for the prefixes that namespace generates. The
   negative lookarounds matter: a bare /bg-ground/ would match inside
   `bg-ground-admin` and call the wrong token read. A leading `hover:` is
   fine -- `:` is not [\w-]. */
const UTILITY_PREFIXES: Record<string, string[]> = {
  color: [
    'bg', 'text', 'border', 'ring', 'outline', 'fill', 'stroke',
    'from', 'via', 'to', 'decoration', 'accent', 'caret', 'shadow',
    'divide', 'placeholder',
  ],
  radius: [
    'rounded', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l',
    'rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl',
    'rounded-s', 'rounded-e', 'rounded-ss', 'rounded-se', 'rounded-es', 'rounded-ee',
  ],
  shadow: ['shadow', 'inset-shadow', 'drop-shadow'],
  font: ['font'],
};

function readersOf(token: string): string[] {
  const [namespace, ...rest] = token.split('-');
  const name = rest.join('-');
  const found: string[] = [];
  // A var() reference from another token counts: that is how the tint
  // reaches --shadow-card-brand and how admin overrides it.
  if (new RegExp(`var\\(\\s*--${token}(?![\\w-])`).test(themeCss)) {
    found.push('theme css var()');
  }
  const prefixes = UTILITY_PREFIXES[namespace] ?? [];
  if (prefixes.length) {
    const re = new RegExp(`(?<![\\w-])(?:${prefixes.join('|')})-${name}(?![\\w-])`);
    for (const [file, src] of markup) if (re.test(src)) found.push(file);
  }
  return found;
}

describe('Recess tokens have readers (#366)', () => {
  /* Scoped to the pass's SEMANTIC tokens. The numeric --radius-* scale is a
     different kind of artifact -- a ramp, whose correctness is ordering
     rather than per-stop usage -- and gets its own test below. */
  const SEMANTIC = /--((?:color-ground|shadow-card|radius-pill)[a-z0-9-]*)\s*:/g;

  const declared = [...new Set([...themeCss.matchAll(SEMANTIC)].map((m) => m[1]))].sort();

  it('finds the tokens the pass introduced (guards the discovery itself)', () => {
    // Without this, a regex that stopped matching would make every test
    // below vacuously green.
    expect(declared).toEqual([
      'color-ground',
      'color-ground-admin',
      'color-ground-raised',
      'radius-pill',
      'shadow-card',
      'shadow-card-brand',
      'shadow-card-tint',
      'shadow-card-tint-admin',
    ]);
  });

  it.each(declared)('--%s is read somewhere', (token) => {
    expect(
      readersOf(token),
      `--${token} is defined and nothing reads it — the exact bug #366 exists to fix`,
    ).not.toEqual([]);
  });
});

describe('brand files stay in parity (#366)', () => {
  /* The readers test above pools all four theme files, so it stays green if
     ONE brand file drops a ground token -- and that is precisely the
     dangerous case. Tailwind compiles per app: apps/web loads base.css +
     sit.css only, so a token missing from sit.css means `bg-ground-raised`
     is not a valid utility THERE, every Card loses its background in sync-sit
     alone, and the other two apps look fine. A token change is never local
     in this package, so the pin is set-equality across the three files. */
  const perBrand = (file: string) =>
    new Set(
      [
        ...stripCss(readFileSync(join(THEME, file), 'utf8')).matchAll(
          /--((?:color-ground|shadow-card-tint)[a-z0-9-]*)\s*:/g,
        ),
      ].map((m) => m[1]),
    );
  const sets = BRAND_FILES.map((f) => [f, perBrand(f)] as const);

  it('finds the per-app tokens (guards the discovery itself)', () => {
    expect([...sets[0][1]].sort()).toEqual([
      'color-ground',
      'color-ground-raised',
      'shadow-card-tint',
    ]);
  });

  it.each(sets.slice(1).map(([f]) => f))('%s defines exactly what sit.css does', (file) => {
    const mine = perBrand(file);
    expect([...mine].sort(), `${file} drifted from sit.css`).toEqual([...sets[0][1]].sort());
  });
});

describe('Card reads the elevation tokens (#366)', () => {
  const card = stripTs(readFileSync(join(SHARED_UI, 'src/components/Card.tsx'), 'utf8'));

  it('emits shadow-card / shadow-card-brand rather than an arbitrary value', () => {
    expect(card).toMatch(/(?<![\w-])shadow-card(?![\w-])/);
    expect(card).toMatch(/(?<![\w-])hover:shadow-card-brand(?![\w-])/);
    // The original bug, verbatim: an inlined box-shadow left --shadow-card
    // with zero readers, so the token could be retuned and no card moved.
    expect(card, 'Card must not inline an arbitrary shadow').not.toMatch(/shadow-\[/);
  });

  it('takes its raised surface from the token, not a literal bg-white', () => {
    expect(card).toMatch(/(?<![\w-])bg-ground-raised(?![\w-])/);
    expect(card).not.toMatch(/(?<![\w-])bg-white(?![\w-])/);
  });
});

describe('authed shells sit on a ground (#366)', () => {
  /* Discovery-plus-allowlist, mirroring focusVisibleRule.test.ts: find every
     full-height shell across the three apps and require a ground token. A new
     authed layout that ships `bg-white` fails the day it lands, instead of
     silently opting out of the visual pass. */
  const ALLOWED_WHITE = [
    'PublicLayout.tsx', // marketing/auth pages are deliberately white
  ];

  const shells = [...markup].filter(
    ([file, src]) => /\/layouts\//.test(file) && /(?<![\w-])min-h-screen(?![\w-])/.test(src),
  );

  it('finds the shells (guards the discovery itself)', () => {
    // Seven authed + three public today; a drop below that means the walk
    // or the min-h-screen anchor broke, not that the apps got simpler.
    expect(shells.length).toBeGreaterThanOrEqual(10);
  });

  it.each(shells.map(([file]) => file))('%s uses a ground token', (file) => {
    const src = markup.get(file)!;
    const line = src.split('\n').find((l) => /min-h-screen/.test(l))!;
    if (ALLOWED_WHITE.some((a) => file.endsWith(a))) {
      expect(line, `${file} is allowlisted as deliberately white`).toMatch(
        /(?<![\w-])bg-white(?![\w-])/,
      );
      return;
    }
    expect(line, `${file} must sit on bg-ground / bg-ground-admin`).toMatch(
      /(?<![\w-])bg-ground(-admin)?(?![\w-])/,
    );
  });
});

describe('admin stays neutral (decision 25)', () => {
  it('the admin tint is WIRED, not merely defined', () => {
    // The override must scope --shadow-card-tint (which Tailwind inlines onto
    // the card element, so it inherits) rather than --shadow-card-brand
    // (which nothing ever emits a var() for).
    expect(baseCss).toMatch(
      /\.bg-ground-admin\s*\{[^}]*--shadow-card-tint:\s*var\(--shadow-card-tint-admin\)/,
    );
  });

  it('the override lives inside @layer base, so app utilities still win', () => {
    const layer = baseCss.indexOf('@layer base {');
    expect(layer).toBeGreaterThan(-1);
    const rule = baseCss.indexOf('.bg-ground-admin {');
    expect(rule).toBeGreaterThan(layer);
    const between = baseCss.slice(layer, rule);
    const depth = (between.match(/{/g) || []).length - (between.match(/}/g) || []).length;
    expect(depth, 'the rule escaped @layer base').toBeGreaterThanOrEqual(1);
  });

  it('AdminLayout still carries the class the override is scoped on', () => {
    // The coupling the CSS rule depends on. Rename the class in the layout
    // and admin silently hovers in the host app's brand again.
    const admin = markup.get('apps/web/src/layouts/AdminLayout.tsx');
    expect(admin).toBeTruthy();
    expect(admin!).toMatch(/(?<![\w-])bg-ground-admin(?![\w-])/);
  });
});

describe('the font is shipped, not just named (#366)', () => {
  const imports = [...baseCss.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const fontPkg = imports.find((s) => /fontsource/.test(s));

  it('base.css imports a font package', () => {
    expect(fontPkg, 'naming a font is not shipping one — --font-sans asked for Inter for months').toBeTruthy();
  });

  it('the package is a real dependency of shared-ui', () => {
    const pkg = JSON.parse(readFileSync(join(SHARED_UI, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toContain(fontPkg);
  });

  it('--font-sans names the family that package actually declares', () => {
    // Read the family out of the package's own @font-face rather than
    // inferring it from the package name: this is the assertion that fails
    // if the token and the import ever drift apart again.
    const require_ = createRequire(join(SHARED_UI, 'package.json'));
    const css = readFileSync(require_.resolve(fontPkg!), 'utf8');
    const families = [...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(families.length).toBeGreaterThan(0);

    const token = baseCss.match(/--font-sans:\s*([^;]+);/)?.[1];
    expect(token).toBeTruthy();
    const first = token!.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    expect(families, `--font-sans leads with "${first}", which no @font-face declares`).toContain(first);
  });

  it('the OFL notice ships with the redistributed font', () => {
    // SIL OFL 1.1 requires the copyright notice to accompany redistribution,
    // and only the .woff2 files reach dist.
    const notice = readFileSync(join(SHARED_UI, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notice).toMatch(/SIL Open Font License/);
    expect(notice).toMatch(/Copyright 2014 The Nunito Project Authors/);
  });
});

describe('radii ramp (#366)', () => {
  const stops = ['sm', 'md', 'lg', 'xl', '2xl', '3xl'];
  const rem = (stop: string) => {
    const m = baseCss.match(new RegExp(`--radius-${stop}:\\s*([\\d.]+)rem`));
    return m ? Number(m[1]) : null;
  };

  it('overrides every stop between sm and 3xl, leaving no Tailwind default in the middle', () => {
    // The round-1 defect: 2xl and 3xl were left at Tailwind's 16px/24px while
    // xl rose to 22px, so rounded-2xl read SQUARER than rounded-xl at all 16
    // logo call sites.
    for (const s of stops) expect(rem(s), `--radius-${s}`).not.toBeNull();
  });

  it('is strictly increasing', () => {
    const values = stops.map(rem) as number[];
    expect(values, `${stops.join(' < ')}`).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size, 'two stops share a value').toBe(values.length);
  });

  it('stays inside Tailwind xs (0.125rem) and 4xl (2rem), which are NOT overridden', () => {
    // Overriding only the middle of the ramp is only safe while the ends
    // bracket it. Push 3xl past 2rem and 4xl must be overridden too.
    expect(rem('sm')!).toBeGreaterThan(0.125);
    expect(rem('3xl')!).toBeLessThan(2);
  });
});
