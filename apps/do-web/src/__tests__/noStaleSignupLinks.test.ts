import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lock-in for issue #435 milestone, PR5: sync-do's own role question is
 * retired — every CLICKABLE in-app link that used to point at the local
 * `/signup` role page must now point either at `/enroll/doer` directly, or
 * at sit's cross-origin `/enroll` (via `sitSignUpUrl`, see
 * LoginPage.tsx/WelcomePage.tsx). This scan makes sure a reverted or
 * newly-added link can't silently point at the retired page again. Mirrors
 * apps/study-web/src/__tests__/noStaleSignupLinks.test.ts.
 *
 * Scope, deliberately: `to="/signup"` / `href="/signup"` JSX attributes —
 * the clickable links this PR's task asked to retarget. It does NOT flag
 * `<Navigate to="/signup">` (AuthGuard.tsx) — an internal SPA-guard
 * fallback for a genuinely-identity-less signed-in visitor, not a link a
 * person clicks, and it CANNOT be pointed directly at a cross-origin URL —
 * `<Navigate>` only resolves same-origin paths. It stays pointed at the
 * local `/signup` ROUTE, which itself now forwards cross-origin via
 * SignUpRedirectPage — that redirect chain is exactly what this scan's one
 * permitted exception (the route registration in router.tsx) exists for.
 */

// This file lives at apps/do-web/src/__tests__/noStaleSignupLinks.test.ts.
const srcRoot = dirname(dirname(fileURLToPath(import.meta.url))); // .../apps/do-web/src
const repoRoot = dirname(dirname(dirname(srcRoot))); // .../apps/do-web/src -> do-web -> apps -> repo root

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// A match on a line containing "Navigate" is an internal guard fallback, not
// a clickable link — excluded (see the file-level comment above).
const LINK_TO_SIGNUP = /\b(?:to|href)\s*=\s*["']\/signup["']/;

describe('no stale /signup links in do-web (issue #435 milestone, PR5)', () => {
  it('every to=/href= link points at the retired /signup only via the route registration itself', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of sourceFiles(srcRoot)) {
      scanned++;
      const isRouterFile = file.endsWith(`${join('src', 'router.tsx')}`);
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!LINK_TO_SIGNUP.test(line)) continue;
        if (line.includes('Navigate')) continue; // internal guard fallback, not a link
        if (isRouterFile && line.includes("path: '/signup'")) continue; // the route registration itself
        offenders.push(`${relative(repoRoot, file)}: ${line.trim()}`);
      }
    }
    // Sanity floor: only guards against the walker silently matching nothing
    // (e.g. an import-path typo) after a refactor.
    expect(scanned).toBeGreaterThan(30);
    expect(offenders, `stale /signup links (issue #435 milestone, PR5): ${offenders.join('; ')}`).toEqual([]);
  });

  it('mutation check: the scan actually catches a stale link (self-test)', () => {
    // Not a real file mutation — proves the regex/exclusion logic above can
    // fail, so a passing result above is meaningful and not a vacuous scan.
    const line = '<Link to="/signup" className="x">Sign up</Link>';
    expect(LINK_TO_SIGNUP.test(line)).toBe(true);
    expect(line.includes('Navigate')).toBe(false);
  });
});
