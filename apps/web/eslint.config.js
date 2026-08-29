import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated output that can contain emitted or vendored JS: build artifacts
  // and coverage reports, whose lcov-report/*.js are third-party scripts.
  // Listed here because ESLint does not read .gitignore, and the plain-JS
  // block below would otherwise lint them.
  globalIgnores(['dist', 'dist-ssr', 'build', '.output', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Plain JS anywhere but public/ -- eslint.config.js today, any future
    // script. Without this block ESLint's directory scan enumerates these
    // files and matches them against nothing: "scanned, matched nothing,
    // reported clean" with an empty rule set (the class #381 closed for the
    // functions packages).
    //
    // sourceType is deliberately unset so ESLint applies its per-extension
    // default -- module for .js/.mjs, commonjs for .cjs -- which is what lets
    // one block cover all three extensions correctly.
    files: ['**/*.{js,cjs,mjs}'],
    ignores: ['public/**'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    // public/ is served to the browser -- firebase-messaging-sw.js today.
    // Service-worker globals plus the firebase namespace the compat bundles
    // attach via importScripts().
    files: ['public/**/*.{js,cjs,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.serviceworker, firebase: 'readonly' },
    },
  },
])
