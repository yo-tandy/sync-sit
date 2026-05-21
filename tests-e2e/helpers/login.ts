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
 */
export async function loginAs(page: Page, email: string, password: string, persona: Persona) {
  await page.goto('/');
  // The login form may be on / or /login depending on route guards;
  // fall back to /login if the email field isn't on the welcome page.
  const emailFieldOnHome = page.getByLabel(/email/i);
  if (!(await emailFieldOnHome.first().isVisible().catch(() => false))) {
    await page.goto('/login');
  }
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in|connexion/i }).click();
  await expect(page).toHaveURL(new RegExp(LANDING_PATH[persona]));
}

export async function logout(page: Page) {
  // Most personas have logout in the hamburger menu; admin uses /admin top bar.
  // Specs that need a clean slate should call this in afterEach.
  const ctx = page.context();
  await ctx.clearCookies();
  await page.goto('/');
}
