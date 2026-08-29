import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vitest config for apps/web.
//
// Mirrors packages/shared/vitest.config.ts where it makes sense (named
// project), but adds the React-specific surface: the @vitejs/plugin-react
// transform, a jsdom environment for hooks and component tests, the same
// @-> ./src alias used by vite.config.ts, and a setup file that wires
// @testing-library/jest-dom matchers into Vitest's expect.
//
// Test files live under apps/web/src/**/__tests__/ by convention, per Agent
// 8's brief (sync-study-project-plan.md §8) -- but the include glob below is
// deliberately WIDER than that convention. It is the same file set
// tsconfig.app.json excludes and tsconfig.test.json includes (#382/#393): a
// stray test file outside __tests__ is then run, type-checked, and kept out
// of the build, rather than silently doing none of the first two.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    name: 'web',
    root: import.meta.dirname,
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
