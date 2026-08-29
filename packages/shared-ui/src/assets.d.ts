/**
 * Asset module declarations for shared-ui.
 *
 * The apps get these from `vite/client` (see each app's tsconfig.app.json
 * "types"), but shared-ui has no Vite dependency of its own and, until the bar
 * marks (#365), no source file here imported an asset at all -- the apps
 * imported them through the package.json `./brand-marks/*` subpath exports.
 * `src/lib/brandMarks.ts` is the first shared-ui module to import one, so the
 * declaration has to live here rather than being inherited.
 *
 * Kept to the formats actually imported. Adding a format means adding a line,
 * deliberately: a blanket wildcard would let a typo'd extension typecheck.
 */
declare module '*.png' {
  const src: string;
  export default src;
}
