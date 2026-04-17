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
 */
export function isRunningAsPWA(): boolean {
  if (typeof window === 'undefined') return false;

  const displayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;

  const iosStandalone =
    typeof navigator !== 'undefined' &&
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  return displayModeStandalone || iosStandalone;
}
