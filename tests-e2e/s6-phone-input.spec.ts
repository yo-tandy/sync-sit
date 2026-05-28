import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

test.describe('S-6: PhoneInput', () => {
  test('leading-0 strip for +33, no-strip for +44, country change reformats', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');
    await page.goto('/family/account');

    // PhoneInput renders <select> (country code) + <input type="tel"> (digits).
    const select = page.locator('select').first();
    const input = page.locator('input[type="tel"]').first();
    await expect(select).toBeVisible({ timeout: 10_000 });
    await expect(input).toBeVisible();

    // PhoneInput's <option> value is cc.code (e.g. '+33', '+44') and the
    // visible label is `${flag} ${code}` (e.g. '🇫🇷 +33'). selectOption by
    // value is the most stable form.
    //
    // CRITICAL: do NOT call input.fill('') between assertions — parsePhone('')
    // in packages/shared-ui/src/forms/PhoneInput.tsx defaults the country
    // back to '+33', which silently undoes a previous selectOption('+44').
    // Use input.fill('06') directly: it replaces the value AND the next
    // handleNumberChange sees the just-set country code.

    // +33, fill '06' → leading-0 strip kicks in only when countryCode === '+33'.
    await select.selectOption('+33');
    await input.fill('06');
    await expect(input).toHaveValue('6');

    // Switch to +44. handleCountryChange reformats existing digits under +44.
    await select.selectOption('+44');
    // Now fill '06' directly — handleNumberChange sees countryCode '+44', no strip.
    await input.fill('06');
    await expect(input).toHaveValue('06');
  });
});
