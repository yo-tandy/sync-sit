import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    root: import.meta.dirname,
    include: ['**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
