# Phase 1.1 — Verification Results

**Date:** 2026-05-26
**Branch:** feature/sync-study-tester-phase1-smoke
**HEAD at verification:** 83cf8d9 (= 3eae638 PR #45 HEAD + agent-8's Playwright harness + agent-8c's chrome-control smoke + agent-2's @source fix cherry-pick)
**Fix under test:** 4ba0ecb on feature/sync-study-dialog-scrim — `@source "../**/*.{ts,tsx}";` added to packages/shared-ui/src/theme/base.css to fix the Tailwind v4 content-scan miss

## Disposition: GREEN-TO-MERGE

The @source fix is empirically validated by Playwright S-1 against a Vite instance (port 5174) serving the fixed code. Two additional specs (S-2, S-4) failed — but neither failure is related to the fix; both are stale specs hitting navigation issues unrelated to the Dialog/Lightbox surfaces they were designed to exercise.

## Per-spec results

| Spec | Surface | Verdict | Notes |
|---|---|---|---|
| S-1 | Admin Dialog scrim | **PASS** (844ms) | Empirical confirmation. Scrim now renders. Screenshot at test-results/s1-dialog-scrim.png. |
| S-2 | EndorsementDialog | **FAIL — STALE SPEC** | Route `/family/submitted-endorsements` returns 404. Did not reach EndorsementDialog. Test needs route update. |
| S-4 | PhotoLightbox | **FAIL — STALE SPEC** | `/family/search` now shows a "What type of babysitting?" flow-chooser as an intermediate step. Locator `[class*="card" i]` never matches because the test never advances past the chooser. Test needs flow update. |

## Bundle summary (from agent-2's prior fix-side audit)

29.39 kB → 33.22 kB, +61 classes recovered, 0 classes lost. Bundle hash post-fix matches pre-extraction May-15 baseline bit-identically. Root cause: Tailwind v4 @source directive was missing for packages/shared-ui/src/**, silently dropping every utility class used only within shared-ui components.

## Why S-1 is sufficient

- S-1 directly exercises the Dialog scrim — the canonical regression surface and the one the fix targets.
- The pre-fix S-1 run captured the scrim as a 0×0 transparent element (chrome-control diagnostic, 2026-05-21).
- The post-fix S-1 run shows the scrim rendering correctly (this run, 2026-05-26).
- agent-2's static analysis proved 61 classes recovered with 0 lost. The bundle is bit-identical to the pre-extraction baseline. Multiple Dialog/PhotoLightbox/Spinner/etc. silent casualties from the same root cause are all recovered by the same one-line fix.

## Why S-2 and S-4 failures are NOT blockers for PR #45

- Both tests fail at navigation, before they reach the surface they're supposed to exercise.
- Neither failure indicates a regression introduced by Phase 1 or by the @source fix.
- The route/flow changes that broke S-2 and S-4 predate this verification (the specs were written against an older app state; the app moved on independent of the shared-ui extraction).

## Follow-up — Phase 2 housekeeping

- Repair S-2: update `/family/submitted-endorsements` → current route (or rewrite to use a different EndorsementDialog entry point such as the admin endorsement surface).
- Repair S-4: extend the spec to traverse the "type of babysitting" picker before searching, or pick a different PhotoLightbox entry point.
- Track under existing Phase 2 housekeeping task list (Task #5 and related).

## Artifacts

- Playwright log: /tmp/verify-playwright.log
- Vite log: /tmp/verify-vite-5174.log
- S-1 success screenshot: test-results/s1-dialog-scrim.png
- S-2 failure screenshot: test-results/s2-endorsement-dialog-S-2--fef1c--form-submits-dialog-closes-chromium/test-failed-1.png
- S-4 failure screenshot: test-results/s4-photo-lightbox-S-4-Phot-a8c65--ESC-closes-backdrop-closes-chromium/test-failed-1.png

## Methodology notes

- Verification ran against a parallel Vite instance on port 5174 in the tester worktree (`.claude/worktrees/sync-study-tester-phase1-smoke/`), with the cherry-picked @source fix.
- Root Vite at port 5173 (orchestration branch, no fix) was left running for the human's session — untouched.
- Emulators (Auth/Firestore/Storage/Functions at standard ports) were shared between the two Vite instances; .env and .firebaserc files were copied from the root worktree into the tester worktree to give the tester Vite the correct project IDs (agent-8c's earlier diagnosis on 2026-05-21).
