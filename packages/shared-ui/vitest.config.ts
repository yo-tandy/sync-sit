import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// First vitest config this package has needed (issue #435 milestone, PR3 --
// its first components with actual render logic to test; the existing
// enrollment steps/pages had no tests of their own, only the consuming
// apps' orchestrator tests). Mirrors apps/web/vitest.config.ts: the
// @vitejs/plugin-react transform, a jsdom environment for RTL, and a setup
// file wiring @testing-library/jest-dom matchers into Vitest's expect.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'shared-ui',
    root: import.meta.dirname,
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
