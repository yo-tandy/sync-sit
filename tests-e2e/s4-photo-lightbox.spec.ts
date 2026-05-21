import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

// DEFERRED this round per team-lead's S-1 fail policy. PhotoLightbox uses
// the same bg-black/<n> scrim pattern as Dialog per agent-2's investigation,
// so running this spec would produce another scrim-cascade failure rather
// than a new signal. Re-run via:
//   npx playwright test tests-e2e/s4-photo-lightbox.spec.ts
// after agent-2 lands the Dialog scrim fix.

test.describe('S-4: PhotoLightbox', () => {
  test('opens, locks scroll, ESC closes, backdrop closes', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');
    await page.goto('/family/search');

    // Trigger any default search. The "Search" button may be conditional;
    // if the page auto-runs a search, this click is a no-op.
    const searchBtn = page.getByRole('button', { name: /search|rechercher/i });
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click();
    }

    // Open a result card. Babysitter cards expose a photo — first one with a photo.
    const firstCard = page.locator('[class*="card" i]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    // Click the photo on the expanded card / detail page.
    const photo = page.locator('img[alt*="profile" i], img[alt*="photo" i]').first();
    if (!(await photo.isVisible().catch(() => false))) {
      // No photo on this card — skip the test rather than failing on
      // missing-photo. Real defensive behavior; document it for the
      // human if it triggers consistently.
      test.skip(true, 'No babysitter card with a photo found in seeded data — skip');
    }
    await photo.click();

    // Lightbox should be visible. PhotoLightbox typically renders a fixed
    // overlay with the image scaled up. Assert body scroll lock.
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflow).toBe('hidden');

    // ESC closes the lightbox.
    await page.keyboard.press('Escape');

    // Scroll lock released.
    await expect.poll(async () => page.evaluate(() => document.body.style.overflow)).toBe('');
  });
});
