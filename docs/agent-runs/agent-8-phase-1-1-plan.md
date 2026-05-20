# Phase 1.1 Smoke Verification — Plan

> **For agentic workers:** This is a verification plan, not a code-change plan. The only file write is `docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md`. No production code is touched. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm PR #45 (Phase 1: `@ejm/shared-core` + `@ejm/shared-ui` extraction, HEAD `3eae638`) has not introduced functional regressions, by running every automated suite available solo and authoring a human-tickable smoke checklist for the Tier-A surfaces called out in the binding test plan.

**Architecture:** Pure verification work. Run automated gates locally in the worktree (typecheck / build / lint / rules-test harness / vitest suites). Capture pass/fail per gate. Then author a single markdown deliverable in `docs/agent-runs/` describing each Tier-A surface, the URL/login path, the expected behaviour, a watch-for hint biased toward Phase 1 regression classes (Tailwind tokens, shared-ui prop drift), and a tick box for the human. End with a SendMessage report to team-lead with a GREEN/YELLOW/RED disposition.

**Tech Stack:** pnpm workspaces, vitest 4, Firebase emulator suite, TypeScript, Vite. The worktree is at `/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-tester-phase1-smoke` on branch `feature/sync-study-tester-phase1-smoke` (off PR #45 HEAD `3eae638`).

---

## Pre-work findings (already done)

- Inspected commits `045b741` and `597d947` on `feature/sync-study-agent-8-tester`. **`597d947` does NOT need porting forward** — it was cherry-picked to integration as commit `8d0db8a` and is already in PR #45 HEAD `3eae638`. Verified by `git log 3eae638 | grep 8d0db8a` (present) and by reading the current `apps/web/src/components/forms/__tests__/PhoneInput.behavior.test.tsx`, which uses the `onCapture` pattern from that fix (lines 70, 81, 88, 191). `045b741` is docs-only (a Phase 1 review PASS) and is not load-bearing.
- Vitest configs inventoried: `apps/web/vitest.config.ts`, `packages/shared/vitest.config.ts`, `packages/shared-core/vitest.config.ts`, `tests/vitest.config.ts`. There is no separate vitest config in `packages/shared-ui` (its tests live alongside the web suite via the shim).

---

## File Structure

| Path | Created / Modified | Responsibility |
|---|---|---|
| `docs/agent-runs/agent-8-phase-1-1-plan.md` | Created (this file) | The plan itself, for team-lead approval. |
| `docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md` | Created by Task 7 | The Tier-A human smoke checklist deliverable. The ONLY non-plan file this agent writes. |
| Everything else | NOT touched | Production code, tests authored by other agents, shared-ui, shared-core, functions, rules — all read-only for this task. |

---

## Task 1: Pre-flight (fresh-worktree dependency install + package build)

**Files:** none modified.

- [ ] **Step 1: Confirm working directory and branch**

```bash
cd /Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-tester-phase1-smoke
git rev-parse HEAD
git status --short
```
Expected: HEAD is `3eae638...`, branch is `feature/sync-study-tester-phase1-smoke`, working tree clean.

- [ ] **Step 2: Install dependencies for the fresh worktree**

```bash
pnpm install
```
Expected: installs successfully; lockfile not modified (run with `--frozen-lockfile` if drift is unexpected — but the team uses pnpm 10 and this worktree mirrors PR #45, so a plain install should be reproducible).

- [ ] **Step 3: Build all workspace packages**

```bash
pnpm -r --filter './packages/**' build
```
Expected: `@ejm/shared-core`, `@ejm/shared-ui`, `@ejm/shared` all build successfully. Captures the package-build phase that team-lead's brief flags as the fresh-worktree pre-flight.

---

## Task 2: Typecheck gate

**Files:** none modified.

- [ ] **Step 1: Run repo-wide typecheck**

```bash
pnpm typecheck 2>&1 | tee /tmp/agent8-typecheck.log | tail -40
```
Expected: PASS across all workspaces (`@ejm/shared-core`, `@ejm/shared-ui`, `@ejm/shared`, `web`, `functions`, `@ejm/tests`). CI is already green at this SHA, so any local FAIL is a worktree problem, not a code problem — surface it to team-lead before proceeding.

- [ ] **Step 2: Record the tail in the eventual SendMessage report**

If FAIL: stop, SendMessage team-lead with the failing workspace + first error block (top ~30 lines from `/tmp/agent8-typecheck.log`).

---

## Task 3: Build gate

**Files:** none modified.

- [ ] **Step 1: Run the top-level build**

```bash
pnpm build 2>&1 | tee /tmp/agent8-build.log | tail -40
```
Expected: PASS — produces the `apps/web` dist. Note: top-level `build` only builds web (`pnpm --filter web build`); package builds were already exercised in Task 1 Step 3.

- [ ] **Step 2: Record asset sizes (Phase 1 risk: CSS shrinkage)**

```bash
ls -lh apps/web/dist/assets/*.css apps/web/dist/assets/*.js 2>/dev/null | head -20
```
Expected: CSS bundle ~29 kB (matches agent-7's report from the Phase 1 review at commit `045b741`). If wildly different (>10% delta either way), flag for team-lead.

---

## Task 4: Lint gate

**Files:** none modified.

- [ ] **Step 1: Run repo-wide lint**

```bash
pnpm lint 2>&1 | tee /tmp/agent8-lint.log | tail -60
```
Expected: PASS or known pre-existing warnings only (per `597d947` commit message, the baseline was 7 `react-hooks/exhaustive-deps` warnings on family pages; 0 errors). New errors = regression.

---

## Task 5: Firestore + Storage rules-test harness

**Files:** none modified.

- [ ] **Step 1: Install the tests workspace deps explicitly**

```bash
pnpm install --filter "@ejm/tests..."
```
Expected: `@ejm/tests` and its transitive deps resolve (was likely already done in Task 1, but the team-lead brief calls it out explicitly; rerunning is a no-op when satisfied).

- [ ] **Step 2: Run the 31-test rules harness on a SEPARATE emulator project**

```bash
npx -y firebase-tools@latest emulators:exec --project demo-test --only firestore,auth,storage \
  'pnpm --filter @ejm/tests exec vitest run rules/' 2>&1 | tee /tmp/agent8-rules.log | tail -80
```
Expected: 31 tests pass — 13 in `firestore-rules.test.ts` + 18 in `storage-rules.test.ts`. Project ID `demo-test` is distinct from the running `sync-sit` emulators (which use the dev project ID), so this will not conflict with the shared dev environment. If any test fails, capture the failing test name + the assertion message and stop.

---

## Task 6: Vitest unit suites (apps/web + packages)

**Files:** none modified.

- [ ] **Step 1: Run apps/web vitest suite**

```bash
pnpm --filter web exec vitest run 2>&1 | tee /tmp/agent8-web-vitest.log | tail -60
```
Expected: ALL tests pass, including the L1–L6 oracle-diff suite. Baseline per `045b741`: 40/40 across 8 files. Count any non-zero failures as regression evidence.

- [ ] **Step 2: Run packages/shared-core vitest suite**

```bash
pnpm --filter @ejm/shared-core exec vitest run 2>&1 | tee /tmp/agent8-shared-core-vitest.log | tail -40
```
Expected: PASS (whatever count the suite holds). Capture test count for the final report.

- [ ] **Step 3: Run packages/shared vitest suite**

```bash
pnpm --filter @ejm/shared exec vitest run 2>&1 | tee /tmp/agent8-shared-vitest.log | tail -40
```
Expected: PASS. Capture count.

- [ ] **Step 4: (If exists) Run packages/shared-ui vitest suite**

```bash
test -f packages/shared-ui/vitest.config.ts && pnpm --filter @ejm/shared-ui exec vitest run 2>&1 | tee /tmp/agent8-shared-ui-vitest.log | tail -40 || echo "no shared-ui vitest config — skipped"
```
Expected: either "skipped" message OR a PASS count. shared-ui currently has no standalone config; tests for its components live in `apps/web/src/components/forms/__tests__/` via the shim path.

---

## Task 7: Author the Tier-A smoke checklist

**Files:**
- Create: `docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md`

**Surfaces to cover (per the brief's Tier-A list and the binding test plan `agent-8-test-plan.md` §4):**

1. Admin dashboard hamburger menu — **agent-2-shared-ui is investigating a Dialog scrim regression on this surface. Per the brief: skip detailed steps; one row that says "see agent-2's report, hold for fix" and a checkbox.**
2. Endorsement dialog (parent → babysitter, EndorsementDialog component)
3. Modify-appointment dialog (RequestDetailPage on babysitter side OR family-side appointment edit)
4. PhotoLightbox (babysitter profile photo viewing — agent-2 deferred this per Q1 of their plan; verify it still renders)
5. SchedulePage (sitter login → WeeklyTimeline grid; toggle a slot)
6. PhoneInput (enrollment Step 4 / babysitter profile edit)
7. AddressAutocomplete (enrollment Step 4 / family settings)
8. Enrollment flow end-to-end (babysitter happy path: email → verify → password → profile → preferences)

For each row, include:
- **URL or login + steps to reach it** — concrete: `http://localhost:5173/...`, account email from the seeded test data.
- **Expected behavior** — 1–2 lines, what success looks like.
- **Watch-for hint** — biased toward Phase 1 regression classes per the §7 corrections in `agent-9-security-baseline.md` and the Phase 1 review notes in `045b741`: (a) Tailwind theme tokens — colour drift between `base.css` / `sit.css`; (b) shared-ui prop-drift on extracted components (Button, Input, Dialog, PhoneInput, AddressAutocomplete); (c) i18n string regressions if the shared-ui barrel changed any key.
- **Blank checkbox `- [ ]`** for the human to tick.

- [ ] **Step 1: Pull the test-data account list from the binding plan**

Read `docs/agent-runs/agent-8-test-plan.md` §4.1 R-pub-3 line and any seed-account mentions in `apps/functions/seed-admin.cjs`. Capture: babysitter `b@ejm.example`, parent `p@ejm.example`, admin (seeded). If a different convention is current in this branch, adjust.

```bash
grep -n "ejm.example\|seedAdmin\|seed-admin" apps/functions/seed-admin.cjs | head -20
```
Expected: confirms the seeded admin account email and any test-fixture accounts.

- [ ] **Step 2: Write the checklist file**

Build `docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md` with:
- Header: title, branch, HEAD, date `2026-05-20`, owner `agent-8-tester`, intended runner `(human)`.
- A summary line ("Tier-A smoke for PR #45. 8 surfaces. ~15 min for a focused operator.").
- One section per surface (in the order above), each containing: title, URL + login, steps, expected, watch-for, checkbox.
- A closing "Disposition handoff" block — the human ticks every row, then this agent's final report is updated.

The file is the single deliverable for this task; no further code edits. Total length: ~140 lines.

- [ ] **Step 3: Verify the file renders cleanly**

```bash
head -40 docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md
wc -l docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md
```
Expected: file exists, ~100–200 lines, no template placeholders left (`<TODO>`, `<fill in>`).

- [ ] **Step 4: Commit the checklist (and this plan)**

```bash
git add docs/agent-runs/agent-8-phase-1-1-plan.md docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md
git commit -m "Add Phase 1.1 smoke verification plan + Tier-A checklist"
```
Expected: one commit on `feature/sync-study-tester-phase1-smoke`. No "Co-Authored-By: Claude" trailer per standing rules. No emoji.

---

## Task 8: Final report to team-lead

**Files:** none modified.

- [ ] **Step 1: Compose the report**

A single SendMessage to `team-lead` (plain text, not JSON) containing:
1. Automated test results table: gate, pass count, brief tail (one or two lines per gate, drawn from the `/tmp/agent8-*.log` captures).
2. Path to the smoke checklist file (`docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md`).
3. Disposition: `GREEN-TO-MERGE` / `YELLOW-MERGE-WITH-FOLLOWUP` / `RED-DO-NOT-MERGE` with reasons. Default expectation per the brief: GREEN, since CI is already green at `3eae638` and the only known concern (Dialog scrim) is owned by agent-2 in parallel.
4. The `597d947` porting verdict: NO PORT NEEDED — already in PR #45 HEAD as `8d0db8a`.

- [ ] **Step 2: If the first tool call from Task 1 blocked on permission**

The brief asks for a parallel "blocked on permission for <tool/command>" SendMessage so team-lead can flag the human proactively. Do this only if blocked.

---

## Constraints (lifted from the standing team rules)

- Spec-first; plan must be approved by team-lead via SendMessage before running anything beyond status/inspection commands. **Stop and wait after writing this file.**
- Branch name stays `feature/sync-study-tester-phase1-smoke`.
- No `Co-Authored-By: Claude` trailer on commits. No emoji in commits, code, or docs.
- Do NOT restart the running emulators or Vite dev server — they are owned by team-lead and shared with the human. The rules-test harness in Task 5 uses project `demo-test`, which is a separate emulator instance.
- Do NOT modify production code, shared-ui, shared-core, functions, rules, or any test authored by another agent. The smoke checklist is the only write.
- The blocked-on-permission heartbeat (Task 8 Step 2) is a hard rule: if the first tool call blocks on a permission prompt, SendMessage team-lead immediately.

## Self-review

- Spec coverage: every item in the brief's "YOUR JOB FOR PHASE 1.1" section maps to a task (automated tests → Tasks 1–6; smoke checklist → Task 7; final report → Task 8; `597d947` porting verdict → pre-work findings + Task 8 Step 1 item 4).
- No placeholders: each command is concrete, each expected outcome is concrete.
- Type/name consistency: file paths and command flags are consistent across tasks (worktree path, log file pattern `/tmp/agent8-*.log`, deliverable path).
