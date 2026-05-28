import { test } from '@playwright/test';

test.describe('S-8a: babysitter enrollment — account portion', () => {
  test.fixme(
    'StepEmail + StepVerify + StepPassword end-to-end',
    async ({ page }) => {
      // Pre-condition: a fresh @ejm.org email never used. Using a
      // timestamp-derived address to avoid the "email already in use" path.
      const email = `smoketest+${Date.now()}@ejm.org`;

      await page.goto('/');
      await page.getByRole('link', { name: /sign up|s'inscrire/i }).click();
      await page.getByRole('button', { name: /babysitter|baby-sitter/i }).click();

      // StepEmail
      await page.getByLabel(/email/i).fill(email);
      await page.getByRole('button', { name: /next|continue|suivant/i }).click();

      // StepVerify — the 6-digit code is in the emulator at
      // verificationCodes/{email}. Reading it programmatically requires
      // either a Firestore Admin SDK call OR a fetch to the emulator's
      // Firestore REST endpoint. Both add infra. Marked fixme.

      // ...rest of flow elided pending verification-code retrieval helper.
    },
  );
});
