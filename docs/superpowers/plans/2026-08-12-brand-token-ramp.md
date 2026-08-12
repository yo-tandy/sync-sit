# Brand Token Ramp (UX F4 / issue #118) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both apps a real `--color-brand-50…800` tonal ramp and migrate every brand-meaning `red-*` utility to `brand-*`, killing the study palette's four-tints-are-one-periwinkle defect (`red-50/100/200/300` all `#adc8ef`) that degrades every soft surface and its text contrast.

**Zero-visual-change contract (except the fix itself):**
- **sync-sit** must render PIXEL-IDENTICAL: its `brand-*` values ARE today's Tailwind red values.
- **sync-study** must render identical at 500/600/700/800 (same blues), while 50/100/200/300 become a proper light ramp — the ONLY intended visual change, and it is the point of the issue.
- This PR does **NOT** reclassify danger/destructive reds into `error-*` — that's a deliberate follow-up (see Task 5). Today study renders its "danger" reds as blue anyway (the remap conflates them); the mechanical rename preserves current appearance exactly, so nothing gets worse and the follow-up starts from a clean vocabulary.

**Scale:** ~565 `red-*` utility occurrences (study-web 198, sit web 275, shared-ui 92). Mechanical, scriptable, but every test that asserts a `red-*` class needs the same rename.

---

## Task 1: token definitions

Files: `packages/shared-ui/src/theme/base.css`, `theme/sit.css`, `theme/study.css`.

- `sit.css`: define `--color-brand-{50,100,200,300,500,600,700,800}` with Tailwind v4's red values — `#FEF2F2, #FEE2E2, #FECACA, #FCA5A5, #EF4444, #DC2626, #B91C1C, #991B1B` (VERIFY against the exact values the current build resolves for `red-*` in sit — they must match byte-for-byte; if sit today uses Tailwind defaults, these are them).
- `study.css`: define the brand ramp — keep `500 #3179DF, 600 #094AD4, 700 #0538A8, 800 #0538A8` exactly as today's remap, and REPLACE the collapsed light end with a real ramp derived from the same hue (blue ~221°): `50 #EEF3FC, 100 #DDE8F9, 200 #BBD1F3, 300 #8FB3EB`. Sanity-check text-contrast pairs: `brand-700` on `brand-50/100` ≥ 4.5:1; `white` on `brand-600` ≥ 4.5:1 (compute, don't eyeball; note the numbers in the commit body).
- DELETE study.css's `--color-red-*` remap entirely — `red-*` reverts to Tailwind's real red in study (any remaining red-* after Task 2's rename MEANS red).
- Add a tiny drift-guard test (node/vitest, wherever shared-ui unit tests live): parse both theme CSS files and assert brand-50/100/200/300 are four DISTINCT values in each app and that sit's brand-600 === #DC2626, study's === #094AD4.

Commit: `feat(shared-ui): real brand token ramps for both apps`

## Task 2: mechanical rename

Scope: `packages/shared-ui/src/**`, `apps/study-web/src/**`, `apps/web/src/**` — source AND tests.

- Rename every Tailwind `red-N` utility occurrence to `brand-N` across all variants (`bg-`, `text-`, `border-`, `ring-`, `divide-`, `from-`, `to-`, `hover:`, `focus:`, `active:`, `disabled:`, `group-hover:` composites…). Script it (regex on `([a-z-]*(?:^|[:-]))red-(50|100|200|300|400|500|600|700|800|900)\b` style — build carefully, review the diff by sampling), then hand-check outliers:
  - `red-400` / `red-900` occurrences (no brand token defined): decide per site — map 400→500 and 900→800 ONLY if the site is brand-meaning AND the value shift is invisible in sit (it isn't — red-400≠red-500), otherwise ADD brand-400/900 tokens to both ramps (sit `#F87171`/`#7F1D1D`, study `#5E93E6`/`#042C68`-class). Prefer adding the tokens: keeps the rename purely mechanical.
  - String-composed class names (template literals, clsx maps, test regexes like `/text-red-600/`) — grep for `red` beyond the utility pattern and fix each.
- The error/danger sites keep their new `brand-*` names for now (contract above) EXCEPT sites already using `error-*` tokens — leave those alone.
- `firebase-messaging-sw.js`, email HTML in functions (inline hex, not Tailwind) — OUT of scope, untouched.

Verification for the zero-change contract: `pnpm --filter web build && pnpm --filter study-web build`, then compare the built CSS: extract the resolved values for a sample of renamed utilities (grep the emitted CSS for `.bg-brand-600{` etc.) and assert sit's match the old red values. Spot-run both dev servers if in doubt.

Commit: `refactor: migrate brand-meaning red-* utilities to brand-* tokens`

## Task 3: tests & gates

- Every existing test that asserted a `red-*` class was renamed with the code (Task 2 covers tests too) — full suites prove it: study-web (≥377), web (≥155), shared-ui drift-guard, lint baselines (study ZERO / sit exactly 1 error + 7 warnings), root typecheck + build.
- FULL tests/integration + tests/rules once — must be UNTOUCHED by this client-only PR (report the baseline number you measured on a clean pre-change run).

## Task 4: visual sanity list (report, no code)

List in your report the study screens whose soft surfaces visibly change (anything using brand-50/100/200/300: hover washes, selected chips, tinted banners, pending badges) — the reviewer and owner will eyeball these. Name the top 5 files by former red-50/100 usage.

## Task 5: follow-up note (no code)

Add one line to `docs/shared-modules-roadmap.md`: danger/destructive UI currently wears `brand-*` (historically red); a semantic pass should move true-danger sites to `error-*` tokens so study's destructive actions stop rendering in brand blue. That's the deliberate next PR.

## Self-review notes

- The rename must be complete-or-absent per occurrence: a `hover:bg-red-50` left behind in study now renders REAL red on hover — grep for any residual `red-` in the three trees at the end and justify every survivor (should be only genuine-red/error sites, which in study-web should be zero given error-* tokens exist).
- Don't touch semantic `--color-error-*` / green/amber/blue tokens.
- sit pixel-identity is the regression bar; study light-tint improvement is the acceptance bar.

> **Post-implementation correction:** sit does NOT use Tailwind default reds — sit.css overrides them with custom EJM reds, and the shipped brand-* tokens pin the EMITTED build values (brand-600 = rgb(223,26,48) / #df1a30, not #DC2626). The drift-guard asserts the emitted values. The hex list above was the plan's incorrect assumption, kept for the record.
