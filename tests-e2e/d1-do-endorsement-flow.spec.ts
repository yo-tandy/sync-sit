import { test, expect } from '@playwright/test';
import { doLoginAs, doLogout } from './helpers/doLogin';

/**
 * D-1: the plan's §13 PR11 e2e leg — post → offer → accept → complete →
 * endorse, in the browser, across BOTH personas.
 *
 * ── HOW TO RUN IT ────────────────────────────────────────────────────────
 * This spec needs the sync-do app served against a seeded emulator stack,
 * which is NOT what the repo's other specs assume (they target apps/web on
 * :5173). Three things must be true:
 *
 *   1. the emulator stack is up on the DEFAULT ports — `pnpm emulators`.
 *      `apps/do-web/src/config/firebase.ts` hardcodes 9099/8080/5001/9199
 *      under `import.meta.env.DEV`, so do-web's dev server can only reach
 *      lane 1. (Making those ports configurable would let this run in an
 *      ephemeral lane; that is an app-source change, not this spec's.)
 *   2. do-web's dev server is up — `pnpm --filter do-web dev` (:5175);
 *   3. the two personas below exist in that stack: a parent in a
 *      FULLY-VERIFIED family (decision 14 — `doPostTask` refuses otherwise,
 *      and the family needs a postcode/city that resolves an area label per
 *      decision 17), and an enrolled, active doer whose
 *      `profiles.doer.enrollmentComplete` is true.
 *
 * Then:
 *   PLAYWRIGHT_BASE_URL=http://localhost:5175 \
 *     npx playwright test tests-e2e/d1-do-endorsement-flow.spec.ts
 *
 * The credentials come from the env so the spec pins no particular seed:
 *   DO_E2E_PARENT_EMAIL / DO_E2E_DOER_EMAIL / DO_E2E_PASSWORD.
 *
 * ── WHAT IT PROVES ───────────────────────────────────────────────────────
 * That the endorsement half of PR11 works end to end through real UI, not
 * just through the callables: the family's prompt appears on completion (it
 * is triggered by `doMarkTaskDone`'s success, so a broken callable shows up
 * here as a missing dialog), the endorsement is PRIVATE until the doer
 * accepts, the doer's §9.2 list can READ it — which is the whole point of
 * the #300 rules amendment, since a missing recipient disjunct renders that
 * list empty rather than erroring — and accepting moves it into the set
 * that families see.
 */

const PARENT_EMAIL = process.env.DO_E2E_PARENT_EMAIL || 'marie.dupont@test.com';
const DOER_EMAIL = process.env.DO_E2E_DOER_EMAIL || 'doer.e2e@ejm.org';
const PASSWORD = process.env.DO_E2E_PASSWORD || 'test1234';

// Unique per run so a re-run never collides with the previous run's task
// (nothing here cleans up, and the board is shared state).
const RUN = Date.now().toString().slice(-6);
const TASK_TITLE = `E2E PAX assembly ${RUN}`;
const OFFER_MESSAGE = `I can do this on Saturday morning. (${RUN})`;
const ENDORSEMENT_TEXT =
  `Assembled everything carefully and cleaned up after. Run ${RUN}.`;

test.describe('D-1: sync-do post → offer → accept → complete → endorse', () => {
  test('the full PR11 leg, family and doer', async ({ page }) => {
    // ── 1. The family posts a task (§9.1's nine-step wizard) ──
    // Every step but the last has ONE footer button, "Next"
    // (`family.post.next`); the review step publishes. Option steps use
    // OptionButton — a <button aria-pressed> whose accessible name is the
    // i18n label. Selectors below are the real EN/FR labels from
    // apps/do-web/src/i18n.
    await doLoginAs(page, PARENT_EMAIL, PASSWORD, 'parent');
    await page.goto('/family/post');

    const next = () => page.getByRole('button', { name: /^Next$|^Suivant$/ }).click();

    // category → Ikea assembly
    await page.getByRole('button', { name: /^Ikea assembly$|^Montage Ikea$/ }).click();
    await next();
    // subCategory → the first option under it
    await page.getByRole('button', { name: /assembl|montage/i }).first().click();
    await next();
    // timing → Deadline, then the "Done by" date
    await page.getByRole('button', { name: /^Deadline$|^Échéance$/ }).click();
    const dueDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel(/Done by|À faire avant/i).fill(dueDate);
    await next();
    // describe
    await page.getByLabel(/^Title|^Titre/i).fill(TASK_TITLE);
    await page
      .getByLabel(/^Description/i)
      .fill('Two-door PAX with a mirror. Tools are here.');
    await next();
    // photos — nothing to add; the pipeline has its own integration coverage
    await next();
    // adultPresent → yes (keeps the §5.7 alone-in-the-home ack out of play)
    await page
      .getByRole('button', { name: /adult will be present|un adulte sera présent/i })
      .click();
    await next();
    // toolsTransport — defaults are valid
    await next();
    // budget — optional
    await next();
    // review → publish
    await expect(page.getByText(/Ready to publish\?|Prêt à publier/i)).toBeVisible();
    await page.getByRole('button', { name: /Publish task|Publier la tâche/i }).click();

    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 15_000 });

    // ── 2. The doer offers (§9.2) ──
    await doLogout(page);
    await doLoginAs(page, DOER_EMAIL, PASSWORD, 'doer');

    // The doer lands on `/doer`, which is the DASHBOARD (issue #360) — it was
    // a redirect to the board when this spec was written, so the click below
    // used to find the task without going anywhere. A doer who has not
    // offered on anything yet has no offers, no assignments and no
    // endorsements, so the dashboard is showing its empty state: the board is
    // now somewhere to GO, not where login leaves you.
    await page.goto('/doer/board');
    await page.getByText(TASK_TITLE).first().click();
    await page.getByRole('link', { name: /Make an offer|Faire une offre/i }).click();

    await page.getByLabel(/Your price|Votre prix/i).fill('45');
    await page.getByLabel(/Message to the family|Message à la famille/i).fill(OFFER_MESSAGE);
    await page.getByRole('button', { name: /Send offer|Envoyer l'offre/i }).click();

    await page.goto('/doer/offers');
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 15_000 });

    // ── 3. The family accepts (§6.4) ──
    // No goto needed here, unlike step 2, and the difference is the point:
    // the parent lands on `/family`, which is the family DASHBOARD, and its
    // first section is the family's live open tasks — this task, badged with
    // the offer just made, its row linking to /family/tasks/:taskId. So the
    // click below still reaches the detail page, now via the dashboard rather
    // than via a redirect to the list. (Checked against the dashboard's open
    // section, which floors on `expiresAt`: a task posted seconds ago in
    // step 1 is nowhere near it.)
    await doLogout(page);
    await doLoginAs(page, PARENT_EMAIL, PASSWORD, 'parent');
    await page.getByText(TASK_TITLE).first().click();

    await expect(page.getByText(OFFER_MESSAGE)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Accept offer|Accepter l'offre/i }).first().click();
    // §11.5: the acceptance dialog repeats the decision-15 liability line.
    await expect(
      page.getByText(/responsibility|responsabilité/i).first(),
    ).toBeVisible();
    // The dialog's confirm CTA — `family.taskDetail.acceptConfirmCta`.
    await page
      .getByRole('button', { name: /Accept & share|Accepter & partager/i })
      .last()
      .click();

    // ── 4. The family completes it (§6.5) — and the §9.1 prompt appears ──
    await expect(
      page.getByRole('button', { name: /Mark as completed|Marquer comme terminée/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole('button', { name: /Mark as completed|Marquer comme terminée/i })
      .first()
      .click();
    await page.getByRole('button', { name: /Yes, it is done|Oui, c'est fait/i }).click();

    // THE PROMPT. It opens on doMarkTaskDone's success, so a broken
    // completion surfaces here as a dialog that never appears.
    const endorsementBody = page.getByLabel(/Your endorsement|Votre recommandation/i);
    await expect(endorsementBody).toBeVisible({ timeout: 15_000 });

    // ── 5. The family endorses (§9.1) ──
    await endorsementBody.fill(ENDORSEMENT_TEXT);
    await page
      .getByRole('button', { name: /Send endorsement|Envoyer la recommandation/i })
      .click();
    // The success state must say it is not live yet — the endorsement is
    // private until the student accepts.
    await expect(
      page.getByText(/Endorsement sent|Recommandation envoyée/i),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Done$|^Terminé$/ }).click();

    // ── 6. The doer sees it pending and accepts (§9.2) ──
    // This step is the #300 amendment's proof: the doc is `private`, so
    // without the `doerUserId` recipient disjunct the list below is EMPTY.
    await doLogout(page);
    await doLoginAs(page, DOER_EMAIL, PASSWORD, 'doer');
    await page.goto('/doer/endorsements');

    await expect(page.getByText(ENDORSEMENT_TEXT)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Waiting for you|En attente de votre réponse/i)).toBeVisible();

    await page.getByRole('button', { name: /^Accept$|^Accepter$/ }).click();

    // It moves into the published set — what families see on offer cards.
    await expect(
      page.getByText(/Shown with your offers|Affichées avec vos offres/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Waiting for you|En attente de votre réponse/i)).toHaveCount(0);
    await expect(page.getByText(ENDORSEMENT_TEXT)).toBeVisible();
  });
});
