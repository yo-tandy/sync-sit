import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Globals for anything under public/: service-worker scope plus the firebase
// namespace the compat bundles attach via importScripts().
const browserWorkerGlobals = { ...globals.serviceworker, firebase: 'readonly' }

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
    // public/ is served to the browser. firebase-messaging-sw.js is a CLASSIC
    // service worker, on two independent grounds: nothing passes a custom
    // serviceWorkerRegistration to getToken(), so Firebase auto-registers it
    // without { type: 'module' }; and it calls importScripts(), which exists
    // only in classic workers and throws in a module one. So sourceType is
    // pinned to 'script' rather than left to ESLint's per-extension default,
    // which would parse .js as ESM and quietly disagree with this comment.
    files: ['public/**/*.js', 'public/**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserWorkerGlobals,
    },
  },
  {
    // A .mjs under public/ is ESM by extension. No such file today; the block
    // exists so one cannot be added and silently match nothing.
    files: ['public/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserWorkerGlobals,
    },
  },
])
