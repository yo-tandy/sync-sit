import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

// DEFERRED this round per team-lead's S-1 fail policy. S-1 (admin Dialog
// scrim) failed — the scrim element is hidden across the whole shared-ui
// Dialog component. Running S-2 now would cascade duplicate scrim-related
// failures. Re-run this spec via:
//   npx playwright test tests-e2e/s2-endorsement-dialog.spec.ts
// as soon as agent-2 lands the Dialog defensive fix.

test.describe('S-2: EndorsementDialog (parent submits endorsement)', () => {
  test('parent opens dialog, fills form, submits, dialog closes', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');

    // Navigate to Submitted Endorsements. Route inferred from
    // apps/web/src/pages/family/SubmittedEndorsementsPage.tsx existence.
    await page.goto('/family/submitted-endorsements');

    // Find the "add endorsement" CTA. Real button label is i18n-translated;
    // try the most likely English/French labels.
    const addCta = page.getByRole('button', { name: /add endorsement|new endorsement|add reference|nouvelle/i });
    await expect(addCta).toBeVisible({ timeout: 10_000 });
    await addCta.click();

    // Dialog content has the form. Pick the babysitter via the select/picker.
    const babysitterPicker = page.getByLabel(/babysitter|nounou/i).first();
    await expect(babysitterPicker).toBeVisible({ timeout: 5_000 });

    // Fill body (>=20 chars to satisfy validation).
    const body = page.getByLabel(/endorsement|recommendation|témoignage|message/i).first();
    await body.fill('Lea is wonderful with our children — they always look forward to her visits.');

    // Submit.
    const submit = page.getByRole('button', { name: /submit|envoyer|save|enregistrer/i });
    await submit.click();

    // Dialog should close — the body input is no longer visible.
    await expect(body).not.toBeVisible({ timeout: 5_000 });
  });
});
