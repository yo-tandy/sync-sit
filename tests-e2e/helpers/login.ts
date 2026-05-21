import { Page, expect } from '@playwright/test';

export type Persona = 'admin' | 'babysitter' | 'parent';

const LANDING_PATH: Record<Persona, string> = {
  admin: '/admin',
  babysitter: '/babysitter',
  parent: '/family',
};

/**
 * Sign in via the LoginPage and wait for the role-routed landing page.
 * Assumes the dev server at http://localhost:5173 with seeded test data
 * (apps/functions/seed-test-data.cjs, password 'test1234').
 *
 * LoginPage (apps/web/src/pages/LoginPage.tsx) uses visual <label>s NOT
 * associated with their inputs via for/id, so getByLabel does not work.
 * Selecting by input type is the stable, i18n-independent option.
 */
export async function loginAs(page: Page, email: string, password: string, persona: Persona) {
  await page.goto('/login');
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  // The submit button is the only <button type="submit"> on the page;
  // its accessible name is i18n-translated (Log in / Connexion / Sign in).
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(LANDING_PATH[persona]), { timeout: 15_000 });
}

export async function logout(page: Page) {
  // Most personas have logout in the hamburger menu; admin uses /admin top bar.
  // Specs that need a clean slate should call this in afterEach.
  const ctx = page.context();
  await ctx.clearCookies();
  await page.goto('/');
}
