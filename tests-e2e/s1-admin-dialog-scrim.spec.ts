import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';
import { expectScrimNonTransparent } from './helpers/scrim';

test.describe('S-1: admin hamburger Dialog scrim', () => {
  test('scrim renders non-transparent when admin menu opens', async ({ page }) => {
    await loginAs(page, 'admin@syncsit.test', 'test1234', 'admin');

    // Phase 5 follow-up (task #6): rewrite to getByRole('button', { name: /open menu/i })
    // when agent-2 lands aria-label="Open menu" on AppBar.tsx hamburger trigger.
    // Until then, the button has no accessible name; it's the only <button>
    // in the bg-red-600 AppBar div, so this structural selector uniquely
    // matches at b1c5509. Brittle on purpose — if the AppBar structure
    // changes, the spec should fail loudly.
    const hamburger = page.locator('.bg-red-600').getByRole('button');
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    // Force a screenshot regardless of pass/fail — this is the
    // canonical visual record for the S-1 regression.
    await page.screenshot({
      path: 'test-results/s1-dialog-scrim.png',
      fullPage: false,
    });

    // Programmatic verdict: scrim mounted + non-transparent.
    await expectScrimNonTransparent(page);

    // Close the dialog to leave clean state for the next spec.
    await page.keyboard.press('Escape');
  });
});
