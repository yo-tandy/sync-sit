import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

// S-9: parent cancels a pending babysitter request.
//
// Regression coverage for the fix where ExpandableBabysitterCard rendered
// the "Cancel Request" button only for the `confirmed` variant, leaving
// parents with no way to withdraw a still-pending request. See
// apps/web/src/components/appointments/ExpandableBabysitterCard.tsx.
//
// Preconditions (apps/functions/seed-test-data.cjs, password 'test1234'):
//   - marie.dupont@test.com — parent, Family Dupont, `fr` locale.
//   - apt-pending-1 — Family Dupont + Camille Moreau, status 'pending'
//     (the only pending request for this family).
//
// This spec MUTATES that appointment (pending -> cancelled), so it needs a
// fresh seed per run — consistent with the workers:1 / shared-emulator
// policy in playwright.config.ts. The parent's locale is French, so the UI
// renders fr strings; selectors below accept either language.

test.describe('S-9: parent cancels a pending request', () => {
  test('expand pending card, cancel the request, dialog closes', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');

    // The pending request card is collapsed by default; its actions live
    // behind the expand toggle. The header button is labelled with the
    // babysitter's name.
    const card = page.getByRole('button', { name: /camille/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // "Cancel Request" / "Annuler la demande" is only rendered for pending
    // cards after the fix — this is the regression-guard assertion.
    const cancelBtn = page.getByRole('button', { name: /cancel request|annuler la demande/i });
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    await cancelBtn.click();

    // The cancel dialog requires a reason before Confirm is enabled.
    const reason = page.locator('textarea').first();
    await expect(reason).toBeVisible({ timeout: 5_000 });
    await reason.fill('Plans changed — we no longer need this date.');

    const confirm = page.getByRole('button', { name: /^(confirm|confirmer)$/i });
    await confirm.click();

    // Dialog closes once cancelAppointment resolves.
    await expect(reason).not.toBeVisible({ timeout: 10_000 });

    // The request leaves the Pending section. It now lives under
    // Declined/Cancelled (which offers Resubmit, not Cancel), so the
    // in-card "Cancel Request" affordance is gone entirely.
    await expect(cancelBtn).toHaveCount(0);
  });
});
