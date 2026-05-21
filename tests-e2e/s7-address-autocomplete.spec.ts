import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

test.describe('S-7: AddressAutocomplete', () => {
  test('input renders and accepts typing — suggestion dropdown is best-effort', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');
    await page.goto('/family/settings');

    // AddressAutocomplete renders an <input> with placeholder
    // "Start typing an address..." (packages/shared-ui/src/forms/AddressAutocomplete.tsx).
    // The visual label has no for/id binding to the input, so use placeholder.
    const address = page.getByPlaceholder(/start typing an address/i).first();
    await expect(address).toBeVisible({ timeout: 10_000 });

    await address.click();
    await address.fill('10 rue de');

    // Defensive: the third-party Places API may or may not be wired in dev.
    // If suggestions appear within 3s, click the first one. Otherwise log
    // and pass — the input rendering itself is the Phase 1 regression scope.
    const suggestion = page.locator('[role="option"], [class*="suggestion" i], [class*="autocomplete" i] li').first();
    const sawSuggestion = await suggestion.isVisible({ timeout: 3_000 }).catch(() => false);
    if (sawSuggestion) {
      await suggestion.click();
      await expect(address).not.toHaveValue('10 rue de');
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'No suggestion dropdown surfaced in 3s — Places API likely unconfigured in dev. Input render-only verdict.',
      });
    }
  });
});
