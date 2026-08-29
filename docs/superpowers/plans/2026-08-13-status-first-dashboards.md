# Status-First Dashboards (issue #120 / UX F6) Implementation Plan

> **For agentic workers:** Work in THIS worktree (`.claude/worktrees/status-dashboards`, branch `feature/status-first-dashboards`). Steps use checkbox (`- [ ]`) syntax.

> **Superseded for the FAMILY dashboard (2026-08-29, #338).** The owner asked
> both parent landing pages to match the provider dashboards, so the study
> family dashboard's hero slot and half-weight tile grid are gone — replaced by
> a "Find a tutor" button over collapsible `DashboardSection` rows, mirroring
> sit. The hero's content was not lost so much as made redundant: it announced
> "you have 2 pending requests" above a tile reading "2 pending", where the
> sections now say it once by showing the two requests. The TUTOR half of this
> plan stands: that dashboard keeps its greeting/availability/section shape,
> and #338 only swapped its local `Section` for the shared `DashboardSection`.

**Goal:** Give the study family and tutor dashboards a single state-driven hero slot (what matters now) and demote everything else to a compact half-weight grid — same data, NO new queries.

**Architecture:** Both dashboards already fetch full snapshots (`study-sessions` by familyId/tutorUserId, `studyContactRequests` likewise) and reduce them to counts. The hero derives from the SAME snapshots: extract the next confirmed session (soonest `status === 'confirmed'` with a start not in the past) alongside the counts in the existing `.then` reducers. Entry cards and the two summary cards become compact tiles in a 2-column grid. The verification gate/banner and the supervision prompt stay above the hero, untouched — they are already correct status-first elements (the issue says so).

**Tech Stack:** React 19 + TS, react-router, firebase getDocs (existing), Tailwind v4 brand tokens, i18next en+fr.

**Constraints (repo law):**
- No emoji in anything you ADD (the existing greeting emoji on the family dashboard: remove it as part of replacing the greeting block — the hero supersedes it; do not add new ones).
- No Co-Authored-By. Study-web lint baseline ZERO. Never `red-*`; `gray-500` floor for meaningful text. 44px targets for small interactive elements.
- NO new Firestore queries, no query shape changes — where-args stay byte-identical (this repo pins that discipline; #135 reviews enforced it). Only the reducers inside existing `.then` callbacks may read more fields.
- The family dashboard test file has load-bearing pins from #135 (last-known-good counts on refetch blips, seeded '1's surviving failed refetch). Those tests MUST keep passing — extend, never weaken. If a pin asserts markup you moved, move the assertion to the new markup with the same semantics and say so in the commit message.
- Grep-verify post-state of every scripted edit. Full gates at the end (study-web + web tests, lints, typecheck).

**Files:**
- Modify: `apps/study-web/src/pages/family/DashboardPage.tsx` (287 lines)
- Modify: `apps/study-web/src/pages/tutor/DashboardPage.tsx` (450 lines)
- Modify: `apps/study-web/src/i18n/en.ts`, `fr.ts`
- Modify: `apps/study-web/src/pages/family/__tests__/DashboardPage.test.tsx`, `apps/study-web/src/pages/tutor/__tests__/DashboardPage.test.tsx`
- Create (optional, only if both dashboards genuinely share it): a small local `DashTile` component per file is fine; do NOT create a shared-ui component for a two-consumer layout tile unless the markup is identical.

---

### Task 1: Family dashboard — hero slot

Current structure (read the file first — line refs approximate): verification banner (~122), search CTA card (~130), requests summary (~146), sessions summary (~181), three EntryCards (~216).

1. Extend the existing `study-sessions` reducer (the `.then` at ~94-108) to ALSO capture the next confirmed session: among docs with `status === 'confirmed'` and a session start >= now, the soonest. Inspect `family/SessionsPage.tsx` for the doc's date/time field names and any existing date-parsing helper — reuse it; do not hand-roll a second parser. Store `nextSession: { id, date, startTime, tutorName? } | null` in the same state object as the counts (rename state to e.g. `sessionData`) so there is still exactly one setState per snapshot.
2. Hero slot, rendered directly under the verification banner, replacing the current standalone search CTA card. Priority (first match wins), all from already-loaded state:
   - `nextSession` exists → hero card: `t('family.dashboard.hero.nextSession')` ("Next session") + formatted date/time + relative day phrasing via `t('family.dashboard.hero.inDays', { count })` / `hero.today` / `hero.tomorrow` (compute day difference with plain Date math; no timer, no live countdown) → links to `/family/sessions`.
   - else `counts.accepted > 0` → hero: `hero.acceptedRequests` ("A tutor accepted your request — book a session", count-aware) → `/family/requests`.
   - else `counts.pending > 0` → hero: `hero.pendingRequests` ("You have {{count}} pending request(s)") → `/family/requests`.
   - else `isVerified === true` → the existing Find-a-tutor search CTA becomes the hero (reuse its i18n keys, promote styling).
   - else (unverified/loading) → no hero; the banner already owns the unverified state. While counts/sessions are still `null`, render nothing in the hero slot (no skeleton flash — same reasoning as the existing null-guarded cards).
   Hero styling: full-width `Card` with `border-brand-200 bg-brand-50`-style emphasis, title `text-base font-bold`, one supporting line, chevron. Distinct from — and visually heavier than — the tiles below.
3. Demote the rest: requests summary, sessions summary, governance, settings, account become compact tiles in a `grid grid-cols-2 gap-3`: icon + title + (for requests/sessions) the count pair inline as `text-xs text-gray-500` (e.g. "2 pending · 1 upcoming"), no description lines. Keep every `aria-label` and link target. The greeting `<h1>` stays; drop the emoji and the `greeting` subtitle line (the hero now carries the "what now" message).

- [ ] Extend reducer + hero + grid; update the existing test file: keep every existing pin passing (especially the blip/last-known-good ones — they assert the counts render; counts now render inside tiles, adjust queries minimally), and ADD hero-priority pins: seeded confirmed-future session → hero shows next-session and links /family/sessions; no session but accepted>0 → accepted hero; only pending>0 → pending hero; all zero + verified → search hero; unverified → no hero, banner present.
- [ ] Commit: `feat(study-web): family dashboard leads with a state-driven hero`

### Task 2: Tutor dashboard — hero slot + grid

Read the file first. Keep untouched at the top: `SupervisionRequestCard`, `VerificationBanner`, and the activation card (identityStatus approved + enrolled) — activation is a status element, it stays above the hero.

1. Extend the existing `study-sessions` reducer (~line 109-123) to capture the tutor's next confirmed session the same way (reuse the same field names/parse as tutor `SessionsPage.tsx`).
2. Hero priority (first match), rendered after the activation card:
   - `pendingRequests > 0` → hero: `tutor.dashboard.hero.pendingRequests` ("{{count}} family request(s) waiting for your answer") → `/tutor/requests`. Requests are the act-now item for tutors.
   - else `pendingSessions > 0` → hero: `hero.pendingSessions` ("{{count}} session(s) awaiting confirmation") → `/tutor/sessions`.
   - else `nextSession` exists → hero: next-session card like the family one → `/tutor/sessions`.
   - else → no hero (the activation card / verification banner already lead).
3. Demote the existing full-width nav/summary cards (requests, sessions, endorsements + the EntryCards: subjects, schedule, account, area if present) to the same 2-column compact tile grid, counts inline. Keep the endorsements pending count visible on its tile.

- [ ] Implement + extend the tutor dashboard test file with the same style of priority pins (pendingRequests beats pendingSessions beats nextSession; zero-state has no hero).
- [ ] Commit: `feat(study-web): tutor dashboard leads with a state-driven hero`

### Task 3: i18n

- [ ] All new keys under `family.dashboard.hero.*` and `tutor.dashboard.hero.*` in BOTH en.ts and fr.ts, real French, i18next plural forms (`_one`/`_other`) where count-based. Grep both files for every key.
- [ ] Commit (may be folded into Tasks 1-2 commits — keys land with their consumers).

### Task 4: Gates + sweeps

- [ ] `pnpm --filter study-web test` green (including the untouched-suite guard: `pnpm --filter web test`).
- [ ] `pnpm --filter study-web lint` zero; `pnpm -r typecheck` clean.
- [ ] Greps: no new emoji (`grep -P "[\x{1F300}-\x{1FAFF}]"` over both dashboards → 0), no `red-*`/`gray-400` in changed files, where-args byte-identical (git diff shows NO changes to any `query(`/`where(` line — verify with `git diff -U0 | grep -E "^[-+].*(query\(|where\()"` returning nothing).
- [ ] Do NOT push, do NOT open a PR, no GitHub comments. Report back with gate outputs and any deviations.

## Self-Review notes (applied)
- "Same data, no new queries" is enforced mechanically (the where-line diff grep in Task 4).
- Hero renders nothing while state is null — matches the page's existing anti-flash discipline.
- The #135 blip pins are the highest-risk tests; the plan requires keeping their semantics, not their exact markup queries.
- Tutor hero ordering puts requests first because they block a family; family hero puts the booked session first because acting on accepted requests is one tap away in second position.
