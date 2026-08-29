import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Node/TS config for a Cloud Functions package — no React rules, and no
// browser globals. `.mjs` because neither functions package sets
// "type": "module", so a plain .js flat config would be reparsed as ESM.
export default defineConfig([
  // `dist` is build output; `*-bundle` dirs are written and removed by
  // scripts/bundle-shared-for-deploy.js during predeploy; `coverage` holds
  // vitest reports, whose lcov-report/*.js are vendored third-party scripts
  // the .cjs/.mjs blocks below would otherwise lint (ESLint does not read
  // .gitignore).
  globalIgnores(['dist', '*-bundle', 'build', '.output', 'coverage']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    // The committed operational scripts (seed / backfill / count), plus any
    // plain .js. Both are CommonJS here because neither package sets
    // "type": "module" - and ESLint's per-extension default would wrongly
    // treat a bare .js as ESM, so sourceType is set explicitly. .cjs alone
    // left plain .js scanned and matched by nothing (PR #383 review).
    files: ['**/*.{js,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    // eslint.config.mjs itself, and any future ESM script. Without this block
    // ESLint's directory scan enumerates it and matches it against nothing --
    // the same "scanned, matched nothing, reported clean" state the .cjs block
    // above exists to eliminate (PR #381 review). Separate from that block
    // because sourceType differs.
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // A leading underscore is the house marker for a binding that exists only
    // to be destructured away (rest-omit in the schema tests). Scoped to the
    // tests: a dead `_foo` in production code should still be an error.
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
])
