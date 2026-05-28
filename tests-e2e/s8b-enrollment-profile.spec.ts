import { test } from '@playwright/test';

test.describe('S-8b: babysitter enrollment — profile portion', () => {
  test.fixme(
    'StepProfile + StepPreferences after S-8a completes',
    async () => {
      // Depends on S-8a producing an authenticated babysitter account
      // mid-enrollment. Blocked on the same emulator-Firestore-read fixture
      // S-8a needs. Once that lands, S-8b chains off the same `page`
      // context.
    },
  );
});
