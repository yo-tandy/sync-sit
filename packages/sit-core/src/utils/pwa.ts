/**
 * Detect whether the app is running in "installed PWA" mode (standalone) as
 * opposed to a regular browser tab.
 *
 * Detection:
 * - Modern browsers (Chrome/Edge/Firefox/Android): `display-mode: standalone`
 *   media query matches when launched from an installed shortcut.
 * - iOS Safari: non-standard `navigator.standalone === true` when launched
 *   from the home-screen icon.
 *
 * Safe to call in SSR / non-browser environments — returns `false`.
 *
 * Note: `window` and `navigator` are typed locally via `globalThis` so this
 * file doesn't require the DOM lib. The shared package is consumed by both
 * the browser app and Cloud Functions (Node), and we don't want to surface
 * browser-only globals to the Node side.
 */
type MatchMediaResult = { matches: boolean };
type WindowLike = { matchMedia?: (query: string) => MatchMediaResult };
type NavigatorLike = { standalone?: boolean };

export function isRunningAsPWA(): boolean {
  const g = globalThis as { window?: WindowLike; navigator?: NavigatorLike };
  if (!g.window) return false;

  const displayModeStandalone =
    typeof g.window.matchMedia === 'function' &&
    g.window.matchMedia('(display-mode: standalone)').matches;

  const iosStandalone = g.navigator?.standalone === true;

  return displayModeStandalone || iosStandalone;
}
