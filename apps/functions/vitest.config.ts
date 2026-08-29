import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: 'functions',
    root: resolve(import.meta.dirname),
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
