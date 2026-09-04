import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { useDocumentGround } from '@ejm/shared-ui';

/**
 * The tinted grounds must reach the document CANVAS, not just each layout's
 * min-h-screen div (#424): iOS Safari's rubber-band overscroll paints the
 * canvas background (propagated from html), and AuthGuard's resolve state
 * renders before the tinted div exists at all. The fix is a three-part
 * coupling — each shell layout stamps `data-ground` on <html> via
 * useDocumentGround, base.css turns the attribute into a background, and
 * the value ('app' | 'admin') must MATCH the ground class the shell's own
 * div carries, or the canvas and the shell diverge in exactly the way the
 * issue describes. Every leg of that coupling can rot independently and
 * silently, so each gets a pin here, in recessTokens.test.ts's style
 * (text-level structural pins + discovery guards).
 *
 * What jsdom CANNOT observe, stated rather than faked: whether the
 * overscroll band actually paints the tint (that is compositor behavior
 * outside any element's box — real-device / device-emulation check only),
 * and whether the auth-resolve frame is visually seamless. What it CAN pin
 * is everything those depend on: the attribute is on <html> synchronously
 * at first paint, it swaps without going stale across a shell transition,
 * it is removed for public surfaces, and the CSS + layouts agree on names.
 */

/* ── structural pins ──────────────────────────────────────────────── */

function repoRoot(dir: string): string {
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found');
    dir = parent;
  }
  return dir;
}

const ROOT = repoRoot(process.cwd());
const stripCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const baseCss = stripCss(
  readFileSync(join(ROOT, 'packages/shared-ui/src/theme/base.css'), 'utf8'),
);
const hookTs = stripTs(
  readFileSync(
    join(ROOT, 'packages/shared-ui/src/hooks/useDocumentGround.ts'),
    'utf8',
  ),
);

/* Every layout file across the three apps — the full set of places a shell
   can declare a ground. __tests__ excluded so this file never counts. */
const LAYOUT_ROOTS = [
  'apps/web/src/layouts',
  'apps/study-web/src/layouts',
  'apps/do-web/src/layouts',
];
const layouts = new Map(
  LAYOUT_ROOTS.flatMap((r) =>
    readdirSync(join(ROOT, r), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.includes('.test.'))
      .map((e) => {
        const p = join(ROOT, r, e.name);
        return [relative(ROOT, p), stripTs(readFileSync(p, 'utf8'))] as const;
      }),
  ),
);

describe('base.css turns data-ground into a canvas background (#424)', () => {
  it("html[data-ground='app'] paints --color-ground, with the no-brand fallback", () => {
    // The fallback matters for the same reason --shadow-card-brand's does:
    // --color-ground is per-brand, and an invalid var() at computed-value
    // time is not "white", it is an unset background on a rule that claimed
    // to set one.
    expect(baseCss).toMatch(
      /html\[data-ground=['"]app['"]\]\s*\{\s*background-color:\s*var\(--color-ground\s*,/,
    );
  });

  it("html[data-ground='admin'] paints --color-ground-admin", () => {
    expect(baseCss).toMatch(
      /html\[data-ground=['"]admin['"]\]\s*\{\s*background-color:\s*var\(--color-ground-admin\)/,
    );
  });

  it('the rules target html, not body', () => {
    // The overscroll canvas takes its color from html's propagated
    // background; a body-only rule would fix the auth flash and leave the
    // rubber band white on pages where body does not cover the viewport.
    expect(baseCss).not.toMatch(/body\[data-ground/);
  });
});

describe('the hook writes the attribute base.css keys on (#424)', () => {
  // The TS side and the CSS side share only a string. Rename either and the
  // rules match nothing — silently, since an unmatched attribute selector
  // is not an error anywhere.
  it('sets and removes data-ground on document.documentElement', () => {
    expect(hookTs).toMatch(/documentElement\.setAttribute\(\s*['"]data-ground['"]/);
    expect(hookTs).toMatch(/documentElement\.removeAttribute\(\s*['"]data-ground['"]/);
  });

  it('runs in useLayoutEffect, so the stamp lands before first paint', () => {
    // With plain useEffect the flash this hook exists to remove gets one
    // frame to happen in.
    expect(hookTs).toMatch(/useLayoutEffect\(/);
    expect(hookTs).not.toMatch(/(?<!Layout)useEffect\(/);
  });
});

describe('every grounded shell stamps the MATCHING ground (#424)', () => {
  /* Discovery-plus-grading, mirroring recessTokens' authed-shells suite:
     find every layout whose min-h-screen shell carries a ground class, and
     require the hook call whose argument names the same ground. Both
     directions — a hook call with no ground class is graded too, so a
     layout cannot stamp a canvas color its own shell contradicts. */
  const GROUND_OF_CLASS = [
    // Order matters: bg-ground would substring-match bg-ground-admin, hence
    // the lookarounds, same form recessTokens uses.
    ['admin', /(?<![\w-])bg-ground-admin(?![\w-])/],
    ['app', /(?<![\w-])bg-ground(?![\w-])/],
  ] as const;

  const grounded = [...layouts].flatMap(([file, src]) => {
    const cls = GROUND_OF_CLASS.find(([, re]) => re.test(src));
    return cls ? [[file, cls[0]] as const] : [];
  });

  it('finds the grounded shells (guards the discovery itself)', () => {
    // Eight today: web Family/Babysitter/Admin/Account, study Family/Tutor,
    // do Family/Doer. A drop means the walk broke, not that shells left.
    expect(grounded.length).toBeGreaterThanOrEqual(8);
    expect(grounded.map(([f]) => f)).toContain('apps/web/src/layouts/AdminLayout.tsx');
    expect(grounded.map(([f]) => f)).toContain('apps/web/src/layouts/AccountLayout.tsx');
  });

  it.each(grounded)('%s calls useDocumentGround(%j)', (file, ground) => {
    const src = layouts.get(file)!;
    expect(
      src,
      `${file} carries bg-ground${ground === 'admin' ? '-admin' : ''} but does not stamp '${ground}' on <html> — its overscroll band and auth-resolve frame stay white (#424)`,
    ).toMatch(new RegExp(`useDocumentGround\\(\\s*['"]${ground}['"]\\s*\\)`));
  });

  it.each([...layouts.keys()])('%s never stamps a ground its shell does not carry', (file) => {
    const src = layouts.get(file)!;
    const call = src.match(/useDocumentGround\(\s*['"](\w+)['"]\s*\)/);
    if (!call) return; // ungrounded layouts (PublicLayout, AuthGuard) stamp nothing
    const declared = grounded.find(([f]) => f === file)?.[1];
    expect(
      declared,
      `${file} stamps '${call[1]}' on <html> but its shell carries no ground class`,
    ).toBeDefined();
    expect(call[1], `${file}: canvas and shell disagree`).toBe(declared);
  });
});

/* ── behavioral pins (jsdom) ──────────────────────────────────────── */

const attr = () => document.documentElement.getAttribute('data-ground');

afterEach(() => {
  document.documentElement.removeAttribute('data-ground');
});

function Shell({ ground }: { ground: 'app' | 'admin' }) {
  useDocumentGround(ground);
  return null;
}

describe('useDocumentGround lifecycle', () => {
  it('stamps the attribute synchronously with render, before paint', () => {
    render(<Shell ground="app" />);
    // No waitFor: useLayoutEffect commits before render() returns, which is
    // the pre-first-paint guarantee the flash fix rests on.
    expect(attr()).toBe('app');
  });

  it('removes the attribute on unmount, so public surfaces fall back to the default canvas', () => {
    const { unmount } = render(<Shell ground="app" />);
    unmount();
    expect(attr()).toBeNull();
  });

  it('a shell SWAP (admin -> app) lands on the incoming ground, not a stale or missing one', () => {
    // key change forces unmount+mount in one commit — the exact shape of a
    // client-side route transition between AdminLayout and FamilyLayout.
    // React runs the outgoing cleanup before the incoming layout-effect, so
    // the remove must not clobber the fresh stamp.
    const { rerender } = render(<Shell key="admin" ground="admin" />);
    expect(attr()).toBe('admin');
    rerender(<Shell key="app" ground="app" />);
    expect(attr()).toBe('app');
  });

  it('a ground PROP change restamps without an unmount', () => {
    const { rerender } = render(<Shell ground="app" />);
    rerender(<Shell ground="admin" />);
    expect(attr()).toBe('admin');
  });

  it('survives StrictMode double-invocation with the attribute still set', () => {
    // StrictMode runs setup -> cleanup -> setup on mount; a hook that only
    // set in the first pass would leave dev permanently unstamped (the
    // useFlashTimer mounted-ref bug, PR #223 round 2, same shape).
    render(
      <StrictMode>
        <Shell ground="app" />
      </StrictMode>,
    );
    expect(attr()).toBe('app');
  });
});
