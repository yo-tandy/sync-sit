import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      include: ['src/**/__tests__/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      root: './tests',
      include: ['**/*.test.ts'],
      testTimeout: 30000,
      hookTimeout: 30000,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
]);
