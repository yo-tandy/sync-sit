import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Works whether vitest runs from the app dir or the workspace root.
function repoRoot(dir: string): string {
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found');
    dir = parent;
  }
  return dir;
}

// Drift guard: both apps import this file, so the reduced-motion clause here
// is the single a11y motion switch for sync-sit AND sync-study (issue #130).
const baseCss = readFileSync(
  join(repoRoot(process.cwd()), 'packages/shared-ui/src/theme/base.css'),
  'utf8',
);

describe('shared-ui base theme', () => {
  it('respects prefers-reduced-motion (WCAG 2.3.3)', () => {
    expect(baseCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(baseCss).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(baseCss).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(baseCss).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });
});
