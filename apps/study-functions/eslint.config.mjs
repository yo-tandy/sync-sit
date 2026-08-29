import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Node/TS config for a Cloud Functions package — no React rules, and no
// browser globals. `.mjs` because these packages are CommonJS (no
// "type": "module"), so a plain .js config would be reparsed as ESM.
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
    rules: {
      // A leading underscore is the house marker for a binding that exists
      // only to be destructured away (rest-omit in the schema tests).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
])
