# Empty States With Actions (issue #125 / UX F11) Implementation Plan

> **For agentic workers:** Work in THIS worktree (`.claude/worktrees/empty-states`, branch `feature/empty-state-ctas`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the five most-visited copy-only empty states with an icon + one line + primary action, via a shared `EmptyState` component.

**Architecture:** One shared-ui component (both apps can adopt it; this PR adopts it at the five study-web sites the issue names). Each site keeps its existing i18n empty copy as the message; only the icon and the action are new. No data or store changes anywhere.

**Tech Stack:** React 19 + TS, react-router `Link`, Tailwind v4 brand tokens, i18next (en + fr).

**Constraints (repo law):**
- No emoji anywhere. No Co-Authored-By. Every string via `t()`, added to BOTH `apps/study-web/src/i18n/en.ts` and `fr.ts` (real French).
- Lint baselines: study-web ZERO problems; if you touch apps/web (you should not need to) its baseline is exactly 1 error / 7 warnings.
- Never `red-*` classes; `gray-500` minimum for meaningful text.
- Grep-verify the post-state of every scripted edit before claiming it in a commit message.
- The loading/error/empty distinction on these pages is LOAD-BEARING (several carry comments like "never conflated with the empty state") — the EmptyState must render exactly where the old empty `<p>` rendered, under the same conditions. Do not touch loading or error branches.
- Full gates at the end: `pnpm --filter study-web test`, `pnpm --filter web test`, both lints, `pnpm -r typecheck`.

**Files:**
- Create: `packages/shared-ui/src/components/EmptyState.tsx` (+ export from the shared-ui barrel, following how Toast/SupervisionChip are exported)
- Create: `apps/study-web/src/__tests__/shared-ui/EmptyState.test.tsx` (convention: shared-ui components are tested from study-web — see Toast.test.tsx there)
- Modify: `apps/study-web/src/pages/family/SessionsPage.tsx` (~line 665), `family/RequestsPage.tsx` (~190), `tutor/RequestsPage.tsx` (~134), `family/SearchPage.tsx` (~299), `family/GovernancePage.tsx` (~178)
- Modify: `apps/study-web/src/i18n/en.ts`, `fr.ts`
- Modify: the five pages' existing test files (add one pin each)

---

### Task 1: EmptyState component (TDD)

`packages/shared-ui/src/components/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Empty state with a next step (UX F11, issue #125). Copy-only empty states
 * tell the user what WOULD appear; this component also gives them the action
 * that makes it appear. Use it wherever a list's empty branch renders — same
 * conditions as the old copy-only <p>, never for loading or error states.
 *
 * The action is optional on purpose: some empties have no sensible next step
 * for this user (then it degrades to icon + line). Pass either `actionTo`
 * (navigation) or `onAction` (in-page, e.g. clear filters) — not both.
 */
interface EmptyStateProps {
  icon: ReactNode;
  message: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, message, actionLabel, actionTo, onAction }: EmptyStateProps) {
  const actionClasses =
    'inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white';
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </div>
      <p className="max-w-xs text-sm text-gray-500">{message}</p>
      {actionLabel && actionTo && (
        <Link to={actionTo} className={actionClasses}>
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className={actionClasses}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
```

Before finalizing the classes, check how shared-ui's `Button` styles its primary variant and match its radius/weight/colors exactly so the CTA looks like every other primary button. If `Button` supports rendering as a link or has an exported class helper, use that instead of duplicating classes — inspect first, duplicate only if there is no clean reuse.

Steps:
- [ ] Write `EmptyState.test.tsx` FIRST (pattern-match Toast.test.tsx in the same dir): renders icon + message; `actionTo` renders a link with the label pointing at the target; `onAction` renders a button and clicking fires it; no action props → no link and no button.
- [ ] Run: fails (component missing). Implement. Run: green.
- [ ] Export from the shared-ui barrel (update any counted-components comment the barrel keeps).
- [ ] Commit: `feat(shared-ui): EmptyState — icon + line + primary action`

### Task 2: Family sessions empty (SessionsPage ~665)

The current branch renders `{t('family.sessions.empty')}` ("No sessions yet — once you book a tutor, your sessions show up here."). Replace that `<p>` with:

```tsx
<EmptyState
  icon={<CalendarIcon className="h-6 w-6" />}
  message={t('family.sessions.empty')}
  actionLabel={t('family.sessions.emptyAction')}
  actionTo="/family/search"
/>
```

New keys: `family.sessions.emptyAction` = "Find a tutor" / "Trouver un tuteur". Check which calendar-ish icon exists in shared-ui Icons (grep); use the closest existing icon — do NOT draw a new one unless none fits.

CAUTION: this page distinguishes load-error/loading/empty (see ~line 197 comment and the #135-era pins). The EmptyState replaces ONLY the empty `<p>`; run the page's full existing test file after.

- [ ] Replace, add pin in the page's test file: empty state renders the action link to /family/search (assert `getByRole('link', { name: ... })` with href).
- [ ] Commit: `feat(study-web): family sessions empty state gets Find-a-tutor action`

### Task 3: Family requests empty (RequestsPage ~190)

Same shape: message `t('family.requests.empty')`, action `family.requests.emptyAction` = "Find a tutor" / "Trouver un tuteur" → `/family/search`, icon: the search or send/mail icon shared-ui has (grep and pick the most semantically apt existing one).

- [ ] Replace + pin + commit: `feat(study-web): family requests empty state gets Find-a-tutor action`

### Task 4: Tutor requests empty (tutor/RequestsPage ~134)

The tutor cannot create requests — families do. The honest next step is discoverability: keep your subjects current so families find you. Action: `tutor.requests.emptyAction` = "Review your subjects" / "Verifier vos matieres" (use proper accents: "Vérifier vos matières") → `/tutor/subjects`. Icon: BookIcon/AcademicIcon if one exists, else UsersIcon.

- [ ] Replace + pin + commit: `feat(study-web): tutor requests empty state points at subjects`

### Task 5: Search results empty (SearchPage ~299)

This one is an IN-PAGE action: the empty copy says "try adjusting your subject, level or filters" — so the action clears the filters. Read the page first to find the filter state setters; wire `onAction` to reset every filter to its default (and the subject/level selections ONLY if the page treats them as filters — if subject is the mandatory search input, leave it and clear just the optional filters; decide from the code and say what you chose in the commit message). Label: `family.search.emptyAction` = "Clear filters" / "Effacer les filtres". Icon: SearchIcon.

If the page's empty state can also appear before any search has run (grep for how it gates the empty message), keep that distinction intact — only the results-empty branch gets the clear-filters action.

- [ ] Replace + pin (clicking the button resets filters — assert a cleared filter's effect, e.g. the select's value) + commit: `feat(study-web): empty search results get a clear-filters action`

### Task 6: Governance empty (GovernancePage ~178)

Message `t('family.governance.empty')` ("No supervised kids yet — add your child to get started."). The add-your-child flow already exists — grep the router for the create-kid-invite route (`CreateKidInvitePage`) and use ITS path; the action label should reuse the page's existing add-kid button label key if the page has one visible elsewhere (grep GovernancePage for the button that opens the flow). If the page's add-kid affordance is an in-page state toggle rather than a route, use `onAction` to trigger the same handler. Icon: ShieldIcon.

- [ ] Replace + pin + commit: `feat(study-web): governance empty state gets add-kid action`

### Task 7: Gates + sweeps

- [ ] `pnpm --filter study-web test` all green; `pnpm --filter web test` all green (guards shared-ui change).
- [ ] `pnpm --filter study-web lint` → zero problems. `pnpm -r typecheck` → clean.
- [ ] Greps: every new i18n key present in BOTH en.ts and fr.ts; zero `red-*`/`gray-400` in changed files; all five sites render `<EmptyState` (grep count = 5).
- [ ] Do NOT push, do NOT open a PR, no GitHub comments. Report back.

## Self-Review notes (applied)
- The five sites' loading/error/empty gating is pinned by earlier PRs (#135) — replacing only the empty `<p>` and rerunning each page's full test file is the guard.
- Component supports action-less use so future adopters can't be forced into a fake CTA.
- Button styling: reuse over duplication, checked in Task 1.
