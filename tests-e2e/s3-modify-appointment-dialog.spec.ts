import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

test.describe('S-3: modify-appointment dialog', () => {
  test.fixme(
    'babysitter modifies endTime — requires seeded confirmed appointment',
    async ({ page }) => {
      // Pre-condition (not enforced in this spec — relies on seed-test-data.cjs):
      // an appointments doc with status='confirmed' for lea.bernard's uid exists.
      // The Phase 1 seed may or may not produce a confirmed appointment for
      // every run; this spec is marked fixme until a deterministic seed
      // fixture lands. Run manually via the Tier-A checklist S-3 row instead.
      // Also deferred under team-lead's S-1 fail policy (Dialog-dependent).
      await loginAs(page, 'lea.bernard@ejm.org', 'test1234', 'babysitter');
      await expect(page).toHaveURL(/\/babysitter/);
    },
  );
});
