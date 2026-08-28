import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Theme wiring pin: the app entry CSS must import Tailwind, the shared base
// tokens, and the DO brand override — in that order (base first, brand
// override second, so do.css's @theme wins), exactly the layering the
// sibling apps use.

describe('index.css theme wiring', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../index.css'), 'utf8');
  const lines = css.split('\n').filter((l) => l.trim().startsWith('@import'));

  it('imports tailwind, base tokens, and the do brand override in order', () => {
    expect(lines).toEqual([
      '@import "tailwindcss";',
      '@import "@ejm/shared-ui/theme/base.css";',
      '@import "@ejm/shared-ui/theme/do.css";',
    ]);
  });

  it('does not import a sibling brand override', () => {
    expect(css).not.toContain('sit.css');
    expect(css).not.toContain('study.css');
  });
});
