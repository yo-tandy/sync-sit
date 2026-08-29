import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vitest config for apps/study-web — mirrors apps/web: React transform,
// jsdom environment, the @ -> ./src alias, and the jest-dom setup file.
//
// Test files live under apps/study-web/src/**/__tests__/ by convention, but
// the include glob below is deliberately WIDER than that convention: it is
// the same file set tsconfig.app.json excludes and tsconfig.test.json
// includes (#382/#393), so a stray test file outside __tests__ is run,
// type-checked, and kept out of the build rather than silently skipped.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    name: 'study-web',
    root: import.meta.dirname,
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
