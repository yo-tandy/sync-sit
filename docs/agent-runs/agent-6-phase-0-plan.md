# Phase 0 Workspace Bootstrap — agent-6 Implementation Plan (v2)

**Task:** #16 — Phase 0 agent-6 workspace bootstrap
**Owner:** agent-6-infrastructure
**Branch:** `feature/sync-study-infrastructure` (worktree)
**§8 brief:** project plan §8 "Agent 6: Infrastructure & Integration" — Phase 0 step 1 item 3 (smoke-test) + Phase 1 step "Workspace setup"
**Goal:** Close out Phase 0 for agent-6 by (a) making the monorepo topology ready for the five sync-study packages without creating any of them, and (b) producing the sync-sit manual smoke-test checklist that gates every future phase boundary alongside agent-8's regression matrix.

**Revision history:** v2 — team-lead 2026-05-16 feedback: explicit "stub vs wait" recommendation, add `tsconfig.base.json` paths analysis, add smoke-test doc, add `pnpm install` verification.

---

## Pre-plan findings

### 1. `pnpm-workspace.yaml` is already wildcard-correct

Current content:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - 'tests'
  - '!apps/mobile'
```
The `packages/*` and `apps/*` globs already match the five future packages (`shared-core`, `shared-ui`, `shared-functions`, `study-web`, `study-functions`) the moment their directories appear in Phase 1+. The `tests` entry is the `@ejm/tests` rules-test harness added during Phase -1 — must stay. §8's quoted spec (line 1320–1326 of the project plan) omits `tests` because it predates that addition; keeping `tests` is correct and overrides the literal spec text.

**Verdict: no change needed; document it.**

### 2. Root `package.json` scripts: stub vs. live-filter — **recommend stub**

The §8 brief calls for "sync-study build/dev commands" alongside the existing sit-targeted scripts (`pnpm --filter web …`). Three options exist:

| Option | Form | When the script works | Cost |
|---|---|---|---|
| (A) Live filter | `"build:study": "pnpm --filter study-web build"` | Auto-activates the moment Phase 3 creates `apps/study-web`. Today: pnpm warns "No projects matched" and exits 0 (empirically verified — see Investigation log below). | Zero Phase 3 follow-up. Risk: future pnpm release could turn the warning into a hard error. |
| (B) Echo stub | `"build:study": "echo 'study-web not yet implemented; see Phase 3' && exit 0"` | Today: prints the placeholder line and exits 0. Phase 3: agent-6 (still owns root scripts) swaps the body for option-A's filter command. | One-line Phase 3 edit. Self-documenting in package.json; durable across pnpm version drift. |
| (C) Wait | (no entry until Phase 3) | Never works today. | Violates §8's Phase 1 step "Update root package.json scripts to include sync-study build/dev commands" — defers a Phase 0 deliverable. |

**My recommendation: Option B (echo stub),** aligning with team-lead's recommendation. Concretely:
- Adds three new scripts: `dev:study`, `build:study`, `build:study-functions`, each an echo stub.
- All existing sit-targeted scripts stay byte-for-byte unchanged.
- A short comment-via-script (`"//study-scripts": "Phase 3 will replace the echo stubs above with pnpm --filter <pkg> ...:` style) is NOT added — it confuses some pnpm versions; the echo text itself is the placeholder.
- Phase 3 cost: one line per script for agent-6 to rewrite. agent-6 owns root scripts in every phase, so no ownership handoff.

Why not Option A despite my Phase 0 v1 leaning that way: the echo form survives the next pnpm major (when `--filter` behavior on unmatched globs has historically tightened across releases), and a developer who runs `pnpm dev:study` today gets a one-line "see Phase 3" message that's clearer than the multi-line pnpm warning. Marginal but real.

**Investigation log (kept for the §7 verification record):**

```
$ pnpm --filter nonexistent build 2>&1 | head -5 ; echo "exit=$?"
apps/functions  |  WARN  Unsupported engine: wanted: {"node":"20"} (current: {"node":"v23.11.0","pnpm":"10.13.1"})
No projects matched the filters in "<repo>"
exit=0
```

### 3. `tsconfig.base.json`: paths — **recommend no change**

Current content:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```
No `paths`, no `references`. Today `@ejm/shared` resolves through:
1. pnpm symlinks `node_modules/@ejm/shared → packages/shared/`.
2. `packages/shared/package.json` declares `"name": "@ejm/shared"`, `"exports": { ".": { "import": "./src/index.ts", "types": "./src/index.ts", "require": "./dist/index.js" } }`.
3. `moduleResolution: "bundler"` in this tsconfig honors the package's `exports` field.

The five new packages will follow the same pattern — each ships its own `package.json` with `name` and `exports`. Pre-declaring root-level `paths` would:
- **Duplicate resolution paths** — `paths` and `exports` resolving the same name to potentially different files (e.g. `paths` → `packages/study-web/src/index.ts`, `exports` → `packages/study-web/dist/index.js`).
- **Lock in §4's still-evolving import surface.** The §4 "stays where" table (project plan lines 532–571) is still resolving which sub-paths each shared-* package exposes (e.g. will `shared-core` expose `@ejm/shared-core/utils/schedule` or only the barrel `@ejm/shared-core`?). Premature `paths` declarations bake those decisions in.
- **Disagree with `moduleResolution: bundler`'s intent.** Bundler resolution is specifically designed to read package.json `exports` over tsconfig `paths`.

Team-lead's framing ("path entries are harmless to add even if packages don't exist yet — they only get resolved when an import references them") is correct in isolation, but the harm here is architectural, not at the type-checker level: it commits the project to dual-source-of-truth resolution. The cost of adding `paths` later (in Phase 1 when shared-core ships) is one-line-per-package and lands in agent-6's ownership anyway.

**Verdict: no change at Phase 0. Re-evaluate at Phase 1 if Agent 1's shared-core extraction reveals a resolution gap that `exports` alone can't fill.**

### 4. Smoke-test scope vs. agent-8's regression matrix

Agent-8's plan (`docs/agent-runs/agent-8-test-plan.md`) is a **51-row sync-sit regression matrix** (§4) + 40-row sync-study scope-coverage matrix (§5), estimated ~90 minutes of manual emulator-driven runtime per phase boundary. It is the **deep** check.

My smoke-test is the **shallow** check that runs first: ~5–15 minutes, eight rows, answering "is anything obviously broken?" before the deep check is even worth starting. Complementary, not duplicative. Each smoke row points to the agent-8 row(s) that drill deeper on the same surface.

---

## File structure

| File | Change | Phase |
|---|---|---|
| `pnpm-workspace.yaml` | None — wildcards already cover the new packages (verified). | 0 (this task) |
| `package.json` (scripts section only) | Add 3 echo-stub scripts: `dev:study`, `build:study`, `build:study-functions`. All other scripts unchanged. | 0 |
| `tsconfig.base.json` | None — workspace-symlink + `exports` resolution is sufficient; revisit at Phase 1 if needed. | 0 |
| `docs/agent-runs/agent-6-phase-0-plan.md` | This plan (already written). | 0 |
| `docs/agent-runs/agent-6-phase-0-smoke-test.md` | NEW — sync-sit smoke-test checklist, ~8 rows, complementary to agent-8 §4. | 0 |
| `docs/agent-runs/agent-6-phase-0-report.md` | Completion report. | 0 |

No source/test/rules/firebase files touched. Triple-gate runs against a maximum of one production-config file change (`package.json` scripts) plus three doc files.

---

## Tasks

### Task 1: Verify `pnpm-workspace.yaml`

**Files:** Read-only.

- [ ] **Step 1:** `cat pnpm-workspace.yaml` — confirm content matches Pre-plan finding §1.
- [ ] **Step 2:** No edit. Record in report: "pnpm-workspace.yaml: no change; `packages/*` + `apps/*` wildcards cover the five new packages; `tests` entry preserved for `@ejm/tests` rules harness."

### Task 2: Add sync-study echo-stub scripts to root `package.json`

**Files:** Modify `package.json` (scripts section only).

- [ ] **Step 1: Apply the edit** — replace:
  ```json
  "scripts": {
    "dev": "pnpm --filter web dev",
    "build": "pnpm --filter web build",
    "build:functions": "pnpm --filter functions build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:unit": "pnpm --filter @ejm/shared test",
    "test:integration": "pnpm --filter @ejm/tests test",
    "seed:admin": "node apps/functions/seed-admin.cjs",
    "emulators": "firebase emulators:start",
    "deploy": "firebase deploy"
  },
  ```
  with:
  ```json
  "scripts": {
    "dev": "pnpm --filter web dev",
    "dev:study": "echo 'study-web not yet implemented; see Phase 3 of docs/sync-study-project-plan.md'",
    "build": "pnpm --filter web build",
    "build:study": "echo 'study-web not yet implemented; see Phase 3 of docs/sync-study-project-plan.md'",
    "build:functions": "pnpm --filter functions build",
    "build:study-functions": "echo 'study-functions not yet implemented; see Phase 3 of docs/sync-study-project-plan.md'",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:unit": "pnpm --filter @ejm/shared test",
    "test:integration": "pnpm --filter @ejm/tests test",
    "seed:admin": "node apps/functions/seed-admin.cjs",
    "emulators": "firebase emulators:start",
    "deploy": "firebase deploy"
  },
  ```
  Notes:
  - Sit defaults (`dev`, `build`, `build:functions`) unchanged.
  - `:study` suffix mirrors `:functions` naming family.
  - Each stub references the plan section that owns the swap so Phase 3 has a breadcrumb.
  - No trailing `&& exit 0` — `echo` exits 0 on its own.

- [ ] **Step 2: Validate JSON**

  Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
  Expected: `ok`

- [ ] **Step 3: Invoke each new script to confirm it prints and exits 0**

  Run:
  ```
  pnpm run dev:study && pnpm run build:study && pnpm run build:study-functions
  ```
  Expected: three echo lines, exit code 0 from each.

### Task 3: Verify `tsconfig.base.json` needs no change

**Files:** Read-only.

- [ ] **Step 1:** `cat tsconfig.base.json` — confirm content matches Pre-plan finding §3.
- [ ] **Step 2:** No edit. Record in report: "tsconfig.base.json: no change; `moduleResolution: 'bundler'` + per-package `exports` field is sufficient. Adding root `paths` deferred to Phase 1 if shared-core extraction reveals a resolution gap."

### Task 4: Author workspace-topology smoke-test checklist

**Files:** Create `docs/agent-runs/agent-6-phase-0-smoke-test.md`.

**Scope choice (option b in team-lead's 2026-05-16 feedback):** A thin checklist of *workspace-level* concerns within agent-6's ownership boundary (pnpm install resolves, root scripts list correctly, typecheck/build/lint green, tsconfig parses, rules-test baseline when rules touched), plus a pointer to agent-8 §4 for app-level functional smoke. The earlier v2 draft of an 8-row app-level smoke straddled agent-8's ownership of the user-facing functional surface; this version stays strictly on agent-6's side of the line.

- [ ] **Step 1: Write the doc**

  Exact content authored verbatim — see "Smoke-test doc body" section below the task list. Shape:
  - Header (purpose, owner, runtime budget, relationship to agent-8 §4 — explicit ownership-split table).
  - Pre-flight (2 steps: clean git status, `pnpm install --frozen-lockfile`).
  - 7 W-rows covering topology resolution surfaces only:
    - W-1 workspace globs resolve, W-2 workspace YAML parses, W-3 root scripts complete list, W-4 study stubs print + exit 0, W-5 tsconfig parses + root typecheck, W-6 build green, W-7 lint green.
    - Optional W-8 rules-test harness (skip when rules unchanged).
  - Hand-off line: when workspace smoke is green, agent-8 runs §4 for user flows.
  - Failure protocol (capture command + last 10 lines, SendMessage team-lead, do not hand off to agent-8).
  - Maintenance rule (updates only on workspace-member / root-script / rules-baseline changes; never on sync-sit feature changes).

### Task 5: Triple validation gate

- [ ] **Step 1:** `pnpm install` — confirm the workspace re-resolves cleanly with the new scripts. Capture last 5 lines.
- [ ] **Step 2:** `pnpm typecheck` — exit 0. Capture last 5 lines.
- [ ] **Step 3:** `pnpm build` — exit 0. Capture last 5 lines.
- [ ] **Step 4:** `pnpm lint` — exit 0, 0 errors, 0 warnings. Capture last 5 lines.
- [ ] **Step 5:** On any failure: `git checkout -- package.json` and SendMessage team-lead with the failure tail. Do NOT commit.

### Task 6: Completion report + commit

**Files:** Create `docs/agent-runs/agent-6-phase-0-report.md`. Stage the changed files. Commit with focused message.

- [ ] **Step 1: Write the report** — contents:
  - Task ID, branch, baseline SHA (`01ae4db`), plan link.
  - List of files changed vs. files inspected-and-unchanged (with one-liner rationale for each unchanged).
  - Verification output (last 5 lines × 4 commands from Task 5).
  - Done-when checklist mapped to §8 Phase 0 / Phase 1 step bullets:
    - [x] pnpm-workspace.yaml verified to cover the five future packages.
    - [x] Root package.json has sync-study build/dev scripts (stubbed, ready for Phase 3 swap).
    - [x] tsconfig.base.json reviewed; no Phase 0 change required.
    - [x] Sync-sit manual smoke-test checklist authored.
    - [x] `pnpm typecheck && pnpm build && pnpm lint` all green.
    - [x] `pnpm install` re-resolves cleanly.
  - Risks for Phase 1+:
    - Phase 3 must swap the echo stubs to real `pnpm --filter` commands.
    - If Phase 1 shared-core extraction reveals a resolution edge case `exports` alone can't cover, revisit `tsconfig.base.json` paths then.
  - `git diff --stat 01ae4db..HEAD` output appended.

- [ ] **Step 2: Stage** — only the files this task actually changed:
  ```
  git add package.json \
           docs/agent-runs/agent-6-phase-0-plan.md \
           docs/agent-runs/agent-6-phase-0-smoke-test.md \
           docs/agent-runs/agent-6-phase-0-report.md
  ```

- [ ] **Step 3: Two focused commits.** Per team-lead's workflow direction ("focused commits per logical change"):

  Commit A — config:
  ```
  git commit -m "$(cat <<'EOF'
  chore(workspace): stub sync-study build/dev scripts (Phase 0 bootstrap)

  Adds dev:study, build:study, build:study-functions to root package.json
  as echo stubs pointing at Phase 3 of the project plan. Sit-targeted
  scripts unchanged. pnpm-workspace.yaml needs no change (existing
  packages/* and apps/* globs already cover the five future packages).
  tsconfig.base.json needs no change at Phase 0 (moduleResolution:bundler
  + per-package exports is sufficient; revisit at Phase 1 if needed).

  Task: #16 (Phase 0 agent-6 workspace bootstrap)
  EOF
  )" -- package.json
  ```

  Commit B — docs:
  ```
  git add docs/agent-runs/agent-6-phase-0-plan.md \
           docs/agent-runs/agent-6-phase-0-smoke-test.md \
           docs/agent-runs/agent-6-phase-0-report.md
  git commit -m "$(cat <<'EOF'
  docs(agent-6): add Phase 0 plan, workspace smoke-test, and completion report

  Plan: investigation log + recommendations (stub vs filter, no
  tsconfig paths). Smoke-test: 7-row workspace-topology check
  (~2-5 min) strictly within agent-6's root-config ownership, with
  pointer to agent-8-test-plan.md §4 for app-level functional smoke.
  Report: verifications + Done-when checklist + Phase 1+ risks.

  Task: #16 (Phase 0 agent-6 workspace bootstrap)
  EOF
  )"
  ```

  No `Co-Authored-By:` trailer. No emoji.

- [ ] **Step 4:** Record both commit SHAs.

### Task 7: Hand off

- [ ] **Step 1:** SendMessage team-lead with the completion report summary (branch, both SHAs, files, last-5-of-each verification, Done-when, risks).
- [ ] **Step 2:** Wait for agents 7+8+9 sign-off routed through team-lead. Do not push or merge until cleared.

---

## Smoke-test doc body (what Task 4 Step 1 will write)

Authored verbatim into `docs/agent-runs/agent-6-phase-0-smoke-test.md`:

```markdown
# Workspace Topology Smoke-Test Checklist (sync-sit)

**Owner:** agent-6-infrastructure
**Project plan anchor:** §8 → "Agent 6: Infrastructure & Integration" → Phase 0 Tasks step 1 item 3
**Companion document:** [docs/agent-runs/agent-8-test-plan.md](agent-8-test-plan.md)
**Runtime budget:** 2–5 minutes per run.
**When to run:** After every phase boundary where agent-6 has merged a root-config change (`pnpm-workspace.yaml`, root `package.json` scripts, `tsconfig.base.json`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, anything in `scripts/`). Purpose: confirm the workspace topology and root config still resolve cleanly **before** agent-8 runs the deep §4 regression matrix against the same SHA.

## Scope split with agent-8 §4

| Layer | Owner | Doc | Runtime |
|---|---|---|---|
| Workspace topology + root config | agent-6 (this doc) | this file | 2–5 min |
| Sync-sit user-facing functional surface | agent-8 | docs/agent-runs/agent-8-test-plan.md §4 (51 rows) | ~90 min |

This doc covers things only agent-6 can touch and only agent-6 can break. Anything user-facing (login, dashboards, search, bookings) is agent-8's surface and lives in `agent-8-test-plan.md §4`. If a topology row here is red, **do not start agent-8 §4** — the deep regression cannot pass when the workspace itself is broken.

## Pass-evidence vocabulary

Lifted from agent-8 §1 for consistency:
- **Visual:** specific CLI output line is present.
- **Log:** specific log/echo line is emitted at a specific level.
- **Exit code:** command returns exit code 0 (or named non-zero).

## Pre-flight (≤60 seconds)

1. `git status` — working tree clean (or only contains the changes under review).
2. `pnpm install --frozen-lockfile` — exits 0; lockfile is in sync with `package.json`.

## Workspace smoke rows (~2–5 minutes total)

| # | Surface | Check | Expected result | Pass tag |
|---|---|---|---|---|
| W-1 | Workspace globs resolve | `pnpm list --depth -1 --json` (or `pnpm m ls`) | Includes at least: `web`, `functions`, `@ejm/shared`, `@ejm/tests`. Any future sync-study packages (`@ejm/shared-core`, `@ejm/shared-ui`, `@ejm/shared-functions`, `study-web`, `study-functions`) appear once Phase 1+ creates them. | Visual (CLI output) |
| W-2 | Workspace YAML parses | `cat pnpm-workspace.yaml` | File parses as YAML; `packages` key lists `packages/*`, `apps/*`, `tests`, `!apps/mobile`. | Visual |
| W-3 | Root scripts present | `pnpm run` | Lists at minimum: `dev`, `dev:study`, `build`, `build:study`, `build:functions`, `build:study-functions`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `seed:admin`, `emulators`, `deploy`. | Visual |
| W-4 | Study stubs print and exit 0 | `pnpm run dev:study && pnpm run build:study && pnpm run build:study-functions` | Each prints the Phase 3 placeholder echo line; combined chain exits 0. (Replace this row's check with the real `pnpm --filter` smoke once Phase 3 swaps the stubs for live commands.) | Log + exit code |
| W-5 | tsconfig parses and root typecheck green | `node -e "JSON.parse(require('fs').readFileSync('tsconfig.base.json','utf8'));console.log('ok')"` then `pnpm typecheck` | First prints `ok`; second exits 0 with no new TS errors vs. the previous green SHA. | Log + exit code |
| W-6 | Build green | `pnpm build` | Exits 0. Sync-sit web bundle produced at `apps/web/dist/` (or whichever output path the current `vite.config.ts` declares). | Visual + exit code |
| W-7 | Lint green | `pnpm lint` | Exits 0 with 0 errors and 0 warnings (matches the Phase -1 lint-cleanup baseline of zero across the repo). | Log + exit code |
| W-8 | Rules-test harness (conditional — only if `firestore.rules` or `storage.rules` changed this phase) | `npx -y firebase-tools@latest emulators:exec --project demo-test --only firestore,auth,storage 'pnpm --filter @ejm/tests exec vitest run rules/'` | Reports the current rules-test baseline green (as of Phase 0: **41/41** = 13 firestore + 18 storage + 5 defense-in-depth + 5 references). Anything less is a hard fail. Skip this row entirely if rules files weren't touched. | Log + exit code |

## After workspace smoke is green

Hand off to agent-8 to run the §4 sync-sit user-facing regression matrix against the same SHA. agent-8 owns the user-flow checks (login, dashboards, search, bookings, schedule edits, references, admin actions, verification, i18n parity, FCM, Resend). agent-6 owns nothing beyond what's in the W-table above.

## Failure protocol

If any W-row is red:
1. Capture the failing command and the last 10 lines of its output.
2. SendMessage team-lead with: phase, W-row ID, output tail, suspected originating commit (`git log --oneline -- <relevant-file>` will usually point at it).
3. Do **not** hand off to agent-8 yet — the deep matrix cannot pass when the workspace itself is broken.
4. Wait for the originating agent's fix + a re-smoke against the new SHA.

If all rows are green: SendMessage team-lead "workspace smoke green at <SHA>" and stand down. Agent-8 then proceeds to run §4 on the same SHA.

## Maintenance

agent-6 owns this doc. Update only when:
- A new workspace member is added or removed (W-1 + W-3 row updates).
- A new root script is added or renamed, or an existing one is removed (W-3 + W-4 row updates).
- The rules-test baseline count changes (W-8 row update — bump the expected total and break it down by category).
- A new root-config file enters agent-6's exclusive-ownership list and needs its own parse check (add a W-row in the W-5 family).

Do **not** update this doc when sync-sit (or sync-study) features change — those belong in `agent-8-test-plan.md §4` and stay there. The workspace smoke is intentionally narrow: topology resolution only.
```

---

## Self-review

**Spec coverage (§8 Phase 0 step 1 + Phase 1 step):**
- §8 Phase 0 step 1.1 "git tag v1.0-pre-refactor" → already done (task #6, completed).
- §8 Phase 0 step 1.2 "Verify pnpm typecheck && pnpm build && pnpm lint passes" → Task 5.
- §8 Phase 0 step 1.3 "Document manual smoke test checklist for sync-sit" → Task 4.
- §8 Phase 1 step "Update pnpm-workspace.yaml" → Task 1 (verified no change).
- §8 Phase 1 step "Update root package.json scripts" → Task 2.
- §8 Phase 1 step "Update tsconfig.base.json if needed" → Task 3 (verified no change).

**Placeholder scan:** no TBDs, no "add appropriate", no "similar to Task N", no undefined function/type references. The smoke-test doc body is written in full inside the plan so the agent (me, in execution) writes it verbatim — no later expansion needed.

**Type consistency:** script names (`dev:study`, `build:study`, `build:study-functions`) spelled identically in plan, edit, report template, and smoke-test W-3/W-4 rows. Package names referenced in stub echoes (none — the stubs are app-name-agnostic). File paths always relative to repo root and matched against the worktree layout. Rules-test baseline count (41/41 = 13+18+5+5) in W-8 matches team-lead's brief.

**Ownership guard:** plan touches only `package.json` (scripts) and three docs under `docs/agent-runs/`. No `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, or `scripts/` touched. No file inside `apps/` or `packages/` touched. No rules-test harness invoked (correct — no rules diff).

**Open question to team-lead:** none. Both deferred decisions (stub vs filter, tsconfig paths) are resolved with explicit recommendations and rationale.
