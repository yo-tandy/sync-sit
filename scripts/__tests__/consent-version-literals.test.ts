import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Issue #415 decision 2: sit ('1.0'), study ('2025-12-01') and do
 * ('2026-08-28') each hardcoded their OWN consentVersion literal -- plus a
 * local `const CONSENT_VERSION = '...'` in four separate files -- instead of
 * importing the one shared `CONSENT_VERSION` from `@ejm/shared-core`
 * (`packages/shared-core/src/constants/config.ts`). All four flows were
 * presenting the SAME legal text; the four literals were an accident of each
 * app's wizard shipping independently, not evidence of distinct documents.
 *
 * This is a source-level pin against that regressing, in the same spirit as
 * brand-marks-no-barrel.test.ts: it scans every tracked `.ts`/`.tsx` file
 * under `apps/*\/src` and fails if any of them either
 *  (a) contain one of the two now-retired dated literals as a complete
 *      quoted string ('2025-12-01' or '2026-08-28'), or
 *  (b) redeclare a local `CONSENT_VERSION` constant instead of importing
 *      the shared one.
 *
 * sit's '1.0' is deliberately NOT banned here: it is still the correct value
 * (CONSENT_VERSION === TOS_VERSION === '1.0' today) and is a legitimate
 * literal for unrelated things (semver-shaped strings, etc) -- banning it
 * would false-positive constantly and doesn't test anything (a) and (b)
 * don't already cover: (b) already guards the one way '1.0' used to sneak
 * back in, as a local re-literal rather than an import.
 *
 * The literal check matches only a COMPLETE quoted string
 * (`'2025-12-01'` / `"2025-12-01"`), never a bare substring -- so an
 * unrelated longer literal that happens to start with the same ten
 * characters (e.g. a full ISO timestamp in an unconnected date fixture,
 * apps/do-web/src/pages/family/post/__tests__/postTaskDraft.test.ts's
 * `new Date('2026-08-28T12:00:00Z')`) does not trip it.
 *
 * Mutation-verified: each assertion below fails if the specific pattern it
 * guards is reintroduced (verified by hand against a scratch file during
 * review; the "checker itself" test below keeps that proof in the suite).
 */

const ROOT = resolve(__dirname, '../..');

/** Every tracked `.ts`/`.tsx` file under `dir` (git-ls-files, not a raw fs
 * walk -- ignores build output/node_modules the same way the repo's other
 * source-grep pins do). */
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

const BANNED_LITERALS = ['2025-12-01', '2026-08-28'];
// Exact-quote match: `(['"])<value>\1` requires the SAME quote character to
// close immediately after the value, so it cannot match inside a longer
// string like an ISO timestamp.
const LITERAL_PATTERNS = BANNED_LITERALS.map((v) => new RegExp(`(['"])${v}\\1`));
const LOCAL_REDECLARATION_PATTERN = /\b(?:const|let|var)\s+CONSENT_VERSION\s*=/;

const appSrcFiles = ['apps/web/src', 'apps/study-web/src', 'apps/do-web/src', 'apps/functions/src', 'apps/study-functions/src']
  .flatMap((dir) => trackedTsFilesRecursive(dir))
  .filter((f) => !f.includes('__tests__') && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

describe('no app source file hardcodes a retired consent-version literal (#415)', () => {
  it('finds app source files to scan (guards the discovery itself)', () => {
    expect(appSrcFiles.length).toBeGreaterThan(100);
  });

  it.each(appSrcFiles)('%s contains no retired consent-version literal', (file) => {
    const src = read(file);
    for (const pattern of LITERAL_PATTERNS) {
      expect(
        pattern.test(src),
        `${file} matches ${pattern} -- a retired app-local consent-version literal (issue #415 decision 2 moved every flow onto the shared CONSENT_VERSION constant)`,
      ).toBe(false);
    }
  });

  it.each(appSrcFiles)('%s does not redeclare a local CONSENT_VERSION', (file) => {
    const src = read(file);
    expect(
      LOCAL_REDECLARATION_PATTERN.test(src),
      `${file} redeclares CONSENT_VERSION locally instead of importing it from @ejm/shared-core`,
    ).toBe(false);
  });

  it('an ISO timestamp that starts with the same digits as a banned literal is not flagged (no false positive)', () => {
    const unrelated = "const NOW = new Date('2026-08-28T12:00:00Z');";
    for (const pattern of LITERAL_PATTERNS) {
      expect(pattern.test(unrelated)).toBe(false);
    }
  });

  it('the checker itself catches a reintroduced literal and a reintroduced local redeclaration (mutation check)', () => {
    const reintroducedLiteralSingle = "const v = '2025-12-01';";
    const reintroducedLiteralDouble = 'const v = "2026-08-28";';
    const reintroducedRedeclaration = "const CONSENT_VERSION = '1.0';";
    const cleanImport = "import { CONSENT_VERSION } from '@ejm/shared-core';";

    expect(LITERAL_PATTERNS.some((p) => p.test(reintroducedLiteralSingle))).toBe(true);
    expect(LITERAL_PATTERNS.some((p) => p.test(reintroducedLiteralDouble))).toBe(true);
    expect(LOCAL_REDECLARATION_PATTERN.test(reintroducedRedeclaration)).toBe(true);
    expect(LOCAL_REDECLARATION_PATTERN.test(cleanImport)).toBe(false);
    expect(LITERAL_PATTERNS.some((p) => p.test(cleanImport))).toBe(false);
  });
});
