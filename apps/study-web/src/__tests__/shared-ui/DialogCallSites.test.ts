import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lock-in for the issue #305 naming sweep: every <Dialog> call site in both
 * apps and shared-ui must pass ariaLabel, which is what opts it into the
 * modal semantics (role=dialog, aria-modal, focus trap, Escape). An unnamed
 * call site silently keeps the legacy plain-div behavior — this scan makes
 * sure a new dialog can't land that way unnoticed.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
// Every app that exists (so a future app is covered the day it lands), plus
// the package that owns the Dialog primitive and renders it itself.
const SCAN_ROOTS = [
  ...readdirSync(join(repoRoot, 'apps'))
    .map((app) => join('apps', app, 'src'))
    .filter((p) => existsSync(join(repoRoot, p))),
  'packages/shared-ui/src',
];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/**
 * Extract each <Dialog ...> opening tag. The tag ends at the first '>' that
 * sits at curly-brace depth 0, so arrows inside prop expressions
 * (onClose={() => ...}) don't terminate it early.
 */
function dialogOpeningTags(source: string): string[] {
  const tags: string[] = [];
  const re = /<Dialog[\s\n]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    for (let i = m.index; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) {
        tags.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

describe('Dialog call sites (repo-wide)', () => {
  it('every <Dialog> in apps/web, apps/study-web, and shared-ui passes ariaLabel', () => {
    const unnamed: string[] = [];
    let total = 0;
    for (const root of SCAN_ROOTS) {
      for (const file of tsxFiles(join(repoRoot, root))) {
        for (const tag of dialogOpeningTags(readFileSync(file, 'utf8'))) {
          total++;
          if (!tag.includes('ariaLabel')) unnamed.push(relative(repoRoot, file));
        }
      }
    }
    // Sanity floor: only guards against the walker silently matching nothing
    // after a refactor (75 sites existed at sweep time) — deliberately loose
    // so legitimately deleting dialogs doesn't trip it.
    expect(total).toBeGreaterThanOrEqual(20);
    expect(unnamed, `unnamed <Dialog> call sites (add ariaLabel — see issue #305): ${unnamed.join(', ')}`).toEqual([]);
  });
});
