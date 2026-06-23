import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vitest config for apps/study-web — mirrors apps/web: React transform,
// jsdom environment, the @ -> ./src alias, and the jest-dom setup file.
// Test files live under apps/study-web/src/**/__tests__/.
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
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
  },
});
