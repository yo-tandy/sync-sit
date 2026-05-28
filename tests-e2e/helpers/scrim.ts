import { Page, Locator, expect } from '@playwright/test';

/**
 * Locator for the Dialog scrim — the dark backdrop behind a modal.
 * Selector matches Dialog.tsx's `<div className="fixed inset-0 bg-black/50" />`.
 * Tailwind compiles `bg-black/50` to a literal class name with a slash, which
 * needs CSS-escaping in the selector.
 */
export function scrim(page: Page): Locator {
  return page.locator('.fixed.inset-0.bg-black\\/50').first();
}

/**
 * Assert the scrim is rendered AND has a non-transparent background color.
 * The S-1 regression class is: scrim mounted but transparent (e.g. token drift
 * or shared-ui prop regression). Tailwind expected output: rgb(0 0 0 / 0.5)
 * (modern) or rgba(0, 0, 0, 0.5) (legacy). Either is acceptable — we only
 * reject fully-transparent rgba(0, 0, 0, 0).
 */
export async function expectScrimNonTransparent(page: Page) {
  const s = scrim(page);
  await expect(s).toBeVisible();
  // Computed style — Playwright normalizes to the browser's rgba() form.
  await expect(s).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
}
