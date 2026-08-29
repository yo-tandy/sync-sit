import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: 'study-functions',
    root: resolve(import.meta.dirname),
    // Deliberately a SUPERSET of the __tests__ convention, matching what
    // tsconfig.json excludes from the build: a stray src/foo/bar.test.ts is
    // then type-checked, kept out of dist AND actually run, rather than
    // silently never executing (PR #380 review).
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
});
