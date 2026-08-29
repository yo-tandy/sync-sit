import { Page, expect } from '@playwright/test';

/**
 * do-web's login helper — the sit-side `loginAs` shape, with do-web's own
 * post-login landings (`postLoginRouter`): parents land on `/family`, doers
 * (and admins, who pass the doer guard) on `/home`.
 *
 * It cannot reuse `helpers/login.ts`: that one's `Persona` map is sit's
 * (`/admin`, `/babysitter`, `/family`) and its base URL is apps/web's
 * :5173. This helper is otherwise identical, including the
 * select-by-input-type rule — the shared LoginPage's labels are visual and
 * not associated to their inputs, and the submit button's accessible name
 * is i18n-translated.
 */
export type DoPersona = 'parent' | 'doer';

const LANDING_PATH: Record<DoPersona, string> = {
  parent: '/family',
  doer: '/home',
};

export async function doLoginAs(
  page: Page,
  email: string,
  password: string,
  persona: DoPersona,
) {
  await page.goto('/login');
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(LANDING_PATH[persona]), { timeout: 15_000 });
}

/** Clear the session between the two personas one spec drives. */
export async function doLogout(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* a storage-blocked context is still logged out by the cookie clear */
    }
  });
  await page.goto('/');
}
