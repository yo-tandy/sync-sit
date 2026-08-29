import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Node/TS config for a Cloud Functions package — no React rules, and no
// browser globals. `.mjs` because neither functions package sets
// "type": "module", so a plain .js flat config would be reparsed as ESM.
export default defineConfig([
  // `dist` is build output; `*-bundle` dirs are written and removed by
  // scripts/bundle-shared-for-deploy.js during predeploy.
  globalIgnores(['dist', '*-bundle']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    // The committed operational scripts (seed / backfill / count). Plain
    // CommonJS, so no typescript-eslint — but they ARE linted rather than
    // scanned and silently matched by nothing (PR #377 review).
    files: ['**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
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
