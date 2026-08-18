import { defineConfig } from 'vitest/config';

// Root-level vitest projects. Vitest 4 replaced the old vitest.workspace.ts
// mechanism with `test.projects` — the workspace file this repo carried was
// silently ignored (and pointed at a path that no longer exists), so it was
// removed in favor of this config. Workspace packages keep their own vitest
// configs and run via their own `test` scripts (root test:unit filters
// them); this config exists for test suites that live OUTSIDE any package,
// currently the scripts/ helpers. test:unit runs it via
// `vitest run --project scripts`. The integration suite deliberately stays
// out — it needs the emulator lifecycle and runs through
// `pnpm --filter @ejm/tests test` (tests/vitest.config.ts).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'scripts',
          root: './scripts',
          include: ['__tests__/**/*.test.ts'],
        },
      },
    ],
  },
});
