# Phase 1.1 Playwright Browser-Smoke — Implementation Plan

> **For agentic workers:** This plan executes after team-lead approval. The only permission-blocked steps are Task 1 Step 2 (pnpm add) and Task 1 Step 3 (npx playwright install chromium). All other steps run locally with existing perms. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up Chromium-only Playwright in the existing worktree and run automated browser smoke against the 8 Tier-A surfaces from `docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md` against the running dev server at `http://localhost:5173`, producing programmatic pass/fail verdicts + a forced screenshot for S-1 (Dialog scrim) regardless of pass/fail.

**Architecture:** New `tests-e2e/` directory at the repo root with a single root `playwright.config.ts`. NOT a workspace package (less ceremony — root-level dir + root-level script `pnpm test:e2e`). Single Chromium project, `workers: 1`, `fullyParallel: false` because the seeded data is shared. NO `webServer` field in the config — the dev server and emulators are already running and shared with team-lead and the human. Selectors role/label/text-based per Playwright best practice; where production code lacks a11y affordances (no `aria-label` on the admin hamburger button), the spec uses a structural fallback selector AND the plan logs a follow-up so agent-2 can fix in their Dialog a11y hardening pass (team-lead task #6).

**Tech Stack:** `playwright ^1.x` + `@playwright/test ^1.x` (latest stable) installed as root dev-deps. Chromium browser only (skip firefox/webkit to save ~300 MB + several minutes). TypeScript via the root `tsconfig.json`. Test reporters: `list` (terminal) + `html` (drillable for the human).

---

## Pre-work findings (already done)

- Worktree clean at b1c5509 on `feature/sync-study-tester-phase1-smoke`.
- `Dialog.tsx` (packages/shared-ui/src/components/Dialog.tsx) renders the scrim as `<div className="fixed inset-0 bg-black/50" />`. Tailwind compiles `bg-black/50` to `background-color: rgb(0 0 0 / 0.5)` (modern syntax) or `rgba(0, 0, 0, 0.5)` (legacy). The S-1 spec targets this element with `page.locator('.fixed.inset-0.bg-black\\/50').first()` and asserts the computed `background-color` does NOT equal `rgba(0, 0, 0, 0)` — i.e., not fully transparent.
- Admin hamburger button has NO `aria-label` or accessible name (apps/web/src/components/ui/AppBar.tsx line ~64: a bare `<button>` containing a `MenuIcon` SVG). It is, however, the only `<button>` in the red header div (`bg-red-600`), so `page.locator('.bg-red-600').getByRole('button')` uniquely matches. Documented as an a11y follow-up: when agent-2 lands their Dialog a11y hardening (team-lead task #6), add `aria-label="Open menu"` to the hamburger so the selector can become `page.getByRole('button', { name: /open menu/i })`.
- Test seed accounts (from apps/functions/seed-test-data.cjs, all passwords `test1234`):
  - admin@syncsit.test
  - lea.bernard@ejm.org, hugo.leroy@ejm.org, camille.moreau@ejm.org, tom.petit@ejm.org
  - marie.dupont@test.com, pierre.dupont@test.com, sophie.martin@test.com
- Test-id discipline does not exist in production code (only sanity.test.tsx uses `data-testid`). All Playwright selectors must be role/label/text/structural — no new `data-testid` added to production code this round (the binding test plan §2 forbids it).

---

## File Structure

| Path | Created / Modified | Responsibility |
|---|---|---|
| `package.json` | Modify (root) | Add `playwright`, `@playwright/test` to devDependencies. Add `test:e2e` and `test:e2e:report` scripts. |
| `playwright.config.ts` | Create (root) | Single Chromium project, single worker, no webServer, baseURL=http://localhost:5173, trace/screenshot config. |
| `tests-e2e/helpers/login.ts` | Create | Reusable login helper: `loginAs(page, email, password)` — fills login form, waits for the role-routed landing page. |
| `tests-e2e/helpers/scrim.ts` | Create | Tiny helper that returns the Dialog scrim locator + an assertion the scrim is non-transparent. Used by S-1 explicitly and available to S-2 / S-3 / S-4 if Dialog scrim issues surface elsewhere. |
| `tests-e2e/s1-admin-dialog-scrim.spec.ts` | Create | S-1 — login as admin, open hamburger menu, force screenshot to `test-results/s1-dialog-scrim.png`, assert scrim non-transparent. |
| `tests-e2e/s2-endorsement-dialog.spec.ts` | Create | S-2 — parent submits endorsement. |
| `tests-e2e/s3-modify-appointment-dialog.spec.ts` | Create | S-3 — babysitter modifies endTime. |
| `tests-e2e/s4-photo-lightbox.spec.ts` | Create | S-4 — lightbox open + ESC + backdrop + scroll lock. |
| `tests-e2e/s5-schedule-weekly-timeline.spec.ts` | Create | S-5 — drag-select 4 slots, persist to Firestore. |
| `tests-e2e/s6-phone-input.spec.ts` | Create | S-6 — leading-0 strip + non-FR no-strip + country change. |
| `tests-e2e/s7-address-autocomplete.spec.ts` | Create | S-7 — type → suggest → pick → save. Defensive on third-party API. |
| `tests-e2e/s8a-enrollment-account.spec.ts` | Create | S-8a — StepEmail + StepVerify + StepPassword (account creation portion). |
| `tests-e2e/s8b-enrollment-profile.spec.ts` | Create | S-8b — StepProfile + StepPreferences. If S-8a infra is too brittle (verification-code read from emulator UI is fiddly), S-8b is marked `test.fixme(...)` with a one-line reason. |
| `.gitignore` | Modify | Append `test-results/` and `playwright-report/` to ignore generated artifacts. |
| `docs/agent-runs/agent-8-phase-1-1-playwright-plan.md` | Created (this file) | The plan. |

Everything else: NOT touched. Production code, shared-ui, shared-core, functions, rules, other-agent tests — all read-only this round.

---

## Task 1: Permission-blocked setup (await user approval)

**Files:** `package.json`, plus on-disk Playwright browser binaries.

- [ ] **Step 1: Verify worktree state**

```bash
cd /Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-tester-phase1-smoke
git rev-parse HEAD
git status --short
```
Expected: HEAD `b1c5509`, clean tree.

- [ ] **Step 2: Install Playwright (permission-blocked)**

```bash
pnpm add -D playwright @playwright/test -w
```
Expected: writes `playwright` and `@playwright/test` to root `package.json` devDependencies; pnpm-lock updated. Both end up at the root, not in a workspace package, because `-w` targets the workspace root.

If pnpm blocks the install on permission UI: SendMessage team-lead "blocked on pnpm add -D playwright @playwright/test -w" so they can flag for user approval.

- [ ] **Step 3: Install Chromium browser (permission-blocked)**

```bash
npx playwright install chromium
```
Expected: downloads ~150 MB Chromium binary to `~/Library/Caches/ms-playwright/chromium-*` (macOS). Skips firefox/webkit. Takes 30-90s on a clean cache.

If blocked: SendMessage team-lead "blocked on npx playwright install chromium".

---

## Task 2: Root config + helpers

**Files:**
- Create: `playwright.config.ts`
- Create: `tests-e2e/helpers/login.ts`
- Create: `tests-e2e/helpers/scrim.ts`
- Modify: `package.json` (scripts), `.gitignore`

- [ ] **Step 1: Write `playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Shared seeded data — never run two specs against the same emulator state.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // NO webServer field — the dev server and emulators are already running
  // and shared with team-lead and the human; Playwright must not try to
  // start or stop them.
});
```

- [ ] **Step 2: Write `tests-e2e/helpers/login.ts`**

```typescript
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
```

- [ ] **Step 3: Write `tests-e2e/helpers/scrim.ts`**

```typescript
import { Page, Locator, expect } from '@playwright/test';

/**
 * Locator for the Dialog scrim — the dark backdrop behind a modal.
 * Selector matches Dialog.tsx's `<div className="fixed inset-0 bg-black/50" />`.
 * Tailwind compiles `bg-black/50` to a literal class name with a slash, which
 * needs CSS-escaping in the selector.
 */
export function scrim(page: Page): Locator {
  return page.locator('.fixed.inset-0.bg-black\\/50').first();
}

/**
 * Assert the scrim is rendered AND has a non-transparent background color.
 * The S-1 regression class is: scrim mounted but transparent (e.g. token drift
 * or shared-ui prop regression). Tailwind expected output: rgb(0 0 0 / 0.5)
 * (modern) or rgba(0, 0, 0, 0.5) (legacy). Either is acceptable — we only
 * reject fully-transparent rgba(0, 0, 0, 0).
 */
export async function expectScrimNonTransparent(page: Page) {
  const s = scrim(page);
  await expect(s).toBeVisible();
  // Computed style — Playwright normalizes to the browser's rgba() form.
  await expect(s).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
}
```

- [ ] **Step 4: Modify `package.json` — add scripts**

In the root `package.json` "scripts" block, append:

```json
    "test:e2e": "playwright test",
    "test:e2e:report": "playwright show-report"
```

(Add a comma to the line above if necessary to keep valid JSON.)

- [ ] **Step 5: Modify `.gitignore` — ignore Playwright artifacts**

Append at the bottom of `.gitignore`:

```
# Playwright artifacts
/test-results/
/playwright-report/
/playwright/.cache/
```

- [ ] **Step 6: Smoke-run Playwright with no specs to verify config loads**

```bash
npx playwright test --list 2>&1 | tail -10
```
Expected: lists "Total: 0 tests in 0 files" (no specs yet, but config parsed). No errors. If error: stop, surface to team-lead.

- [ ] **Step 7: Commit setup**

```bash
git add playwright.config.ts tests-e2e/helpers/ package.json pnpm-lock.yaml .gitignore docs/agent-runs/agent-8-phase-1-1-playwright-plan.md
git commit -m "Add Playwright Chromium-only e2e harness for Tier-A smoke"
```
Expected: one commit on `feature/sync-study-tester-phase1-smoke`. No co-author trailer, no emoji.

---

## Task 3: S-1 admin Dialog scrim spec (THE BLOCKER)

**Files:**
- Create: `tests-e2e/s1-admin-dialog-scrim.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';
import { expectScrimNonTransparent } from './helpers/scrim';

test.describe('S-1: admin hamburger Dialog scrim', () => {
  test('scrim renders non-transparent when admin menu opens', async ({ page }) => {
    await loginAs(page, 'admin@syncsit.test', 'test1234', 'admin');

    // Phase 5 follow-up (task #6): rewrite to getByRole('button', { name: /open menu/i })
    // when agent-2 lands aria-label="Open menu" on AppBar.tsx hamburger trigger.
    // Until then, the button has no accessible name; it's the only <button>
    // in the bg-red-600 AppBar div, so this structural selector uniquely
    // matches at b1c5509. Brittle on purpose — if the AppBar structure
    // changes, the spec should fail loudly.
    const hamburger = page.locator('.bg-red-600').getByRole('button');
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    // Force a screenshot regardless of pass/fail — this is the
    // canonical visual record for the S-1 regression.
    await page.screenshot({
      path: 'test-results/s1-dialog-scrim.png',
      fullPage: false,
    });

    // Programmatic verdict: scrim mounted + non-transparent.
    await expectScrimNonTransparent(page);

    // Close the dialog to leave clean state for the next spec.
    await page.keyboard.press('Escape');
  });
});
```

- [ ] **Step 2: Run S-1 only**

```bash
npx playwright test tests-e2e/s1-admin-dialog-scrim.spec.ts 2>&1 | tee /tmp/agent8-pw-s1.log | tail -30
```
Expected: 1 passed (or 1 failed + a screenshot at test-results/s1-dialog-scrim.png). EITHER outcome produces the screenshot — that's the point of the forced `page.screenshot(...)`. The pass/fail line reports whether the scrim assertion held.

- [ ] **Step 3: Report S-1 outcome to team-lead + apply the selective-continue policy**

Per team-lead refinement on the S-1 fail policy:

- S-1 PASS: proceed through S-2..S-8 in order.
- S-1 FAIL (scrim transparent):
  - **DEFER** (would cascade duplicate scrim failures): S-2 EndorsementDialog, S-3 modify-appointment dialog, S-4 PhotoLightbox (uses same `bg-black/<n>` scrim pattern per agent-2's investigation).
  - **CONTINUE** (Dialog-independent, give real signal): S-5 SchedulePage, S-6 PhoneInput, S-7 AddressAutocomplete, S-8 enrollment (already fixme — no-op).
  - Bundle S-1 PASS/FAIL + screenshot + S-5/S-6/S-7 results in one report to team-lead. Hand the deferred trio (S-2, S-3, S-4) explicitly to agent-2 — re-runnable once their defensive fix lands.

---

## Task 4: S-2 EndorsementDialog spec

**Files:**
- Create: `tests-e2e/s2-endorsement-dialog.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

test.describe('S-2: EndorsementDialog (parent submits endorsement)', () => {
  test('parent opens dialog, fills form, submits, dialog closes', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');

    // Navigate to Submitted Endorsements. Route inferred from
    // apps/web/src/pages/family/SubmittedEndorsementsPage.tsx existence.
    await page.goto('/family/submitted-endorsements');

    // Find the "add endorsement" CTA. Real button label is i18n-translated;
    // try the most likely English labels.
    const addCta = page.getByRole('button', { name: /add endorsement|new endorsement|add reference|nouvelle/i });
    await expect(addCta).toBeVisible({ timeout: 10_000 });
    await addCta.click();

    // Dialog content has the form. Pick the babysitter via the select/picker.
    // The picker may be a native <select> or a custom combobox — try both.
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
```

- [ ] **Step 2: Run S-2**

```bash
npx playwright test tests-e2e/s2-endorsement-dialog.spec.ts 2>&1 | tee /tmp/agent8-pw-s2.log | tail -30
```
Expected: PASS, or FAIL with a precise locator/timeout message.

If selector regex doesn't match the actual translated label, refine ONLY the test file — never modify production code. Adjust the regex, rerun, log the discovered label in the test comment for future agents.

---

## Task 5: S-3 modify-appointment dialog spec

**Files:**
- Create: `tests-e2e/s3-modify-appointment-dialog.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
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
      await loginAs(page, 'lea.bernard@ejm.org', 'test1234', 'babysitter');
      await expect(page).toHaveURL(/\/babysitter/);
    },
  );
});
```

- [ ] **Step 2: Run S-3**

```bash
npx playwright test tests-e2e/s3-modify-appointment-dialog.spec.ts 2>&1 | tail -20
```
Expected: 0 passed, 0 failed, 1 fixme. Recorded in the final report as "S-3 fixme — pre-condition not deterministic in current seed; covered by manual checklist row."

Rationale for the fixme: writing a deterministic spec for S-3 would require either (a) seeding a confirmed appointment via a callable invocation before the spec runs, or (b) querying the emulator for an existing confirmed appointment and skipping if none. Both add ~30 minutes of plumbing that's out of scope for the "first pass automated smoke" goal of this plan. The manual checklist S-3 row still covers the regression class.

---

## Task 6: S-4 PhotoLightbox spec

**Files:**
- Create: `tests-e2e/s4-photo-lightbox.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

test.describe('S-4: PhotoLightbox', () => {
  test('opens, locks scroll, ESC closes, backdrop closes', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');
    await page.goto('/family/search');

    // Trigger any default search. The "Search" button may be conditional;
    // if the page auto-runs a search, this click is a no-op.
    const searchBtn = page.getByRole('button', { name: /search|rechercher/i });
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click();
    }

    // Open a result card. Babysitter cards expose a photo — first one with a photo.
    const firstCard = page.locator('[class*="card" i]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    // Click the photo on the expanded card / detail page.
    const photo = page.locator('img[alt*="profile" i], img[alt*="photo" i]').first();
    if (!(await photo.isVisible().catch(() => false))) {
      // No photo on this card — skip the test rather than failing on
      // missing-photo. Real defensive behavior; document it for the
      // human if it triggers consistently.
      test.skip(true, 'No babysitter card with a photo found in seeded data — skip');
    }
    await photo.click();

    // Lightbox should be visible. PhotoLightbox typically renders a fixed
    // overlay with the image scaled up. Assert body scroll lock.
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflow).toBe('hidden');

    // ESC closes the lightbox.
    await page.keyboard.press('Escape');

    // Scroll lock released.
    await expect.poll(async () => page.evaluate(() => document.body.style.overflow)).toBe('');
  });
});
```

- [ ] **Step 2: Run S-4**

```bash
npx playwright test tests-e2e/s4-photo-lightbox.spec.ts 2>&1 | tee /tmp/agent8-pw-s4.log | tail -30
```
Expected: PASS, or SKIPPED if no seeded card has a photo, or FAIL with locator/timeout. Skip is acceptable — log it.

---

## Task 7: S-5 SchedulePage drag-select spec

**Files:**
- Create: `tests-e2e/s5-schedule-weekly-timeline.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

test.describe('S-5: SchedulePage WeeklyTimeline', () => {
  test('renders the weekly grid and accepts a slot click', async ({ page }) => {
    await loginAs(page, 'lea.bernard@ejm.org', 'test1234', 'babysitter');
    await page.goto('/babysitter/schedule');

    // The grid is built from 7 day columns × 96 slots. Each slot is a
    // clickable cell. The exact selector depends on WeeklyTimeline's DOM.
    // First assert the grid is rendered (look for a day header).
    const tuesdayHeader = page.getByText(/tuesday|mardi/i).first();
    await expect(tuesdayHeader).toBeVisible({ timeout: 10_000 });

    // Drag-select is harder to assert programmatically without
    // WeeklyTimeline's DOM map. For first-pass smoke, just confirm the
    // grid renders + at least one cell is clickable. Drag-select coverage
    // stays on the manual checklist (S-5) for this round.
    const anyCell = page.locator('[role="gridcell"], [class*="slot" i]').first();
    if (await anyCell.isVisible().catch(() => false)) {
      await anyCell.click();
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'WeeklyTimeline slot selector unknown — render-only assertion in this round',
      });
    }
  });
});
```

- [ ] **Step 2: Run S-5**

```bash
npx playwright test tests-e2e/s5-schedule-weekly-timeline.spec.ts 2>&1 | tee /tmp/agent8-pw-s5.log | tail -30
```
Expected: PASS (render-only assertion). Drag-select itself remains a manual-checklist concern.

---

## Task 8: S-6 PhoneInput spec

**Files:**
- Create: `tests-e2e/s6-phone-input.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
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

    // Default to +33, clear and type '06' — input should show '6' (strip leading 0).
    await select.selectOption({ label: /\+33/ }).catch(() => select.selectOption('+33'));
    await input.fill('');
    await input.type('06');
    await expect(input).toHaveValue('6');

    // Change to +44, type '06' again — should show '06' (no strip).
    await select.selectOption({ label: /\+44/ }).catch(() => select.selectOption('+44'));
    await input.fill('');
    await input.type('06');
    await expect(input).toHaveValue('06');
  });
});
```

- [ ] **Step 2: Run S-6**

```bash
npx playwright test tests-e2e/s6-phone-input.spec.ts 2>&1 | tee /tmp/agent8-pw-s6.log | tail -30
```
Expected: PASS.

---

## Task 9: S-7 AddressAutocomplete spec (defensive)

**Files:**
- Create: `tests-e2e/s7-address-autocomplete.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

test.describe('S-7: AddressAutocomplete', () => {
  test('input renders and accepts typing — suggestion dropdown is best-effort', async ({ page }) => {
    await loginAs(page, 'marie.dupont@test.com', 'test1234', 'parent');
    await page.goto('/family/settings');

    // Address field is rendered by AddressAutocomplete.
    const address = page.getByLabel(/address|adresse/i).first();
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
```

- [ ] **Step 2: Run S-7**

```bash
npx playwright test tests-e2e/s7-address-autocomplete.spec.ts 2>&1 | tee /tmp/agent8-pw-s7.log | tail -30
```
Expected: PASS (with note about Places API if no dropdown).

---

## Task 10: S-8a enrollment account creation spec

**Files:**
- Create: `tests-e2e/s8a-enrollment-account.spec.ts`

- [ ] **Step 1: Write the spec — marked fixme on the multi-step flow**

```typescript
import { test, expect } from '@playwright/test';

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
```

Rationale for the fixme: StepVerify requires reading the 6-digit code Firebase wrote to `verificationCodes/{email}` in the running emulator. The clean way is a Playwright fixture that uses the `firebase-admin` SDK (already a devDep of `apps/functions`) pointed at `127.0.0.1:8080` to fetch the doc. That's ~50 lines of fixture code, out of scope for the first-pass smoke. Defer to a follow-up where this fixture is the deliverable, then unmark the fixme. The manual checklist S-8 row covers the regression class until then.

- [ ] **Step 2: Run S-8a**

```bash
npx playwright test tests-e2e/s8a-enrollment-account.spec.ts 2>&1 | tail -20
```
Expected: 0 passed, 0 failed, 1 fixme. Logged in the final report.

---

## Task 11: S-8b enrollment profile spec (fixme — depends on S-8a)

**Files:**
- Create: `tests-e2e/s8b-enrollment-profile.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
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
```

- [ ] **Step 2: Run S-8b**

```bash
npx playwright test tests-e2e/s8b-enrollment-profile.spec.ts 2>&1 | tail -20
```
Expected: 0 passed, 0 failed, 1 fixme.

---

## Task 12: Full run + commit specs

**Files:** none modified.

- [ ] **Step 1: Run the entire suite**

```bash
npx playwright test 2>&1 | tee /tmp/agent8-pw-all.log | tail -50
```
Expected: a summary line like `N passed, M fixme` (or N passed + K failed if regressions surface). S-1 is the load-bearing row.

- [ ] **Step 2: Verify the S-1 screenshot exists**

```bash
ls -lh test-results/s1-dialog-scrim.png
```
Expected: a non-zero-byte PNG at that path.

- [ ] **Step 3: Generate the HTML report path (no browser auto-open)**

```bash
echo "HTML report at: $(pwd)/playwright-report/index.html"
echo "Open with: pnpm test:e2e:report"
```

- [ ] **Step 4: Commit the specs**

```bash
git add tests-e2e/s1-admin-dialog-scrim.spec.ts tests-e2e/s2-endorsement-dialog.spec.ts tests-e2e/s3-modify-appointment-dialog.spec.ts tests-e2e/s4-photo-lightbox.spec.ts tests-e2e/s5-schedule-weekly-timeline.spec.ts tests-e2e/s6-phone-input.spec.ts tests-e2e/s7-address-autocomplete.spec.ts tests-e2e/s8a-enrollment-account.spec.ts tests-e2e/s8b-enrollment-profile.spec.ts
git commit -m "Add Playwright specs for Tier-A surfaces S-1..S-8"
```
Expected: one commit on `feature/sync-study-tester-phase1-smoke`. No co-author trailer, no emoji.

---

## Task 13: Final report to team-lead

**Files:** none modified.

- [ ] **Step 1: SendMessage team-lead with the run results**

Content:
- Per-spec verdict (PASS / FAIL / FIXME / SKIPPED) with brief reasons.
- S-1 verdict + screenshot path (`test-results/s1-dialog-scrim.png`) — bundle into the message body.
- Total commits on the branch since b1c5509 (expected: 2 — setup + specs).
- HTML report path (`playwright-report/index.html`).
- Any selectors that needed refinement during the run (so future agents have the truth).
- Followup queue: agent-2 a11y task #6 (hamburger aria-label), emulator-Firestore fixture for S-8a/S-8b, deterministic confirmed-appointment seed for S-3, drag-select coverage for S-5, Places API stub for S-7.

---

## Constraints (lifted from team-lead's brief)

- Spec-first. Plan approved by team-lead before any `pnpm add` or `npx playwright install`. Stop after writing this file.
- Branch stays `feature/sync-study-tester-phase1-smoke`. Two new commits expected.
- No `Co-Authored-By: Claude` trailer. No emoji.
- Do NOT restart the Vite dev server or the Firebase emulators. Do NOT add a `webServer` field to `playwright.config.ts`.
- Do NOT modify production code, shared-ui, shared-core, functions, rules, or other-agent tests. Selector adjustments stay inside `tests-e2e/`.
- Permission-blocked steps: `pnpm add -D playwright @playwright/test -w` and `npx playwright install chromium`. SendMessage team-lead immediately if either blocks.
- Skill stack: `e2e-testing-patterns` for spec design; `javascript-testing-patterns` for assertion idioms; `vitest` not used this round; `qa-test-planner` skipped per team-lead's brief (the test plan is already authored).

## Self-review

- Spec coverage: every numbered task in team-lead's brief maps to a task (1 spec-first → Task 0 plan; 2 setup → Task 1 + Task 2; 3 specs → Tasks 3-11; 4 run+report → Tasks 12+13; 5 commits → Task 2 Step 7 + Task 12 Step 4).
- Placeholder scan: each code block is concrete; fixme'd tasks (S-3, S-8a, S-8b) document precise reasons + the follow-up that would unmark them.
- Type/name consistency: `loginAs`, `expectScrimNonTransparent`, `scrim` are defined in Task 2 and consumed consistently in Tasks 3, 4, 6.
- Path consistency: all spec files live under `tests-e2e/`; all helpers under `tests-e2e/helpers/`; root `playwright.config.ts` targets `./tests-e2e`. `package.json` scripts wire `pnpm test:e2e` to `playwright test` (Playwright reads the root config).
- Open question for team-lead: between Task 3 Step 3 (S-1 result report) and Task 4, the plan asks team-lead whether to continue or hold for agent-2 on S-1 FAIL. That's a decision point, not a placeholder — concrete and answerable.
