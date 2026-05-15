import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vitest config for apps/web.
//
// Mirrors packages/shared/vitest.config.ts where it makes sense (named
// project, include glob keyed on __tests__ directories), but adds the
// React-specific surface: the @vitejs/plugin-react transform, a jsdom
// environment for hooks and component tests, the same @-> ./src alias
// used by vite.config.ts, and a setup file that wires
// @testing-library/jest-dom matchers into Vitest's expect.
//
// Test files live under apps/web/src/**/__tests__/ per Agent 8's brief
// (sync-study-project-plan.md §8). Agent 8 is the only author of files
// in these directories during the sync-study project.
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
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
  },
});
