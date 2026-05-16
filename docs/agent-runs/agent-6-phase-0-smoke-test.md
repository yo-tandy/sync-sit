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

## Pre-flight in a fresh worktree (one-time, ≤30 seconds)

**Required the first time a worktree runs the smoke** (or any time `packages/shared/dist/` is empty):

0. `pnpm --filter @ejm/shared build` — populates `packages/shared/dist/`.

Why: `apps/functions/tsconfig.json` uses `moduleResolution: "node"` (classic resolver), which reads `@ejm/shared` from its built `dist/` artifacts rather than the `exports` field of `packages/shared/package.json`. Build artifacts are git-ignored, so a freshly-checked-out worktree has an empty `dist/` and `pnpm typecheck` will fail in `apps/functions` until shared is built once. (Source: agent-8 harness pre-work final report, note N1, commit `d68a0a0`.) `apps/web` uses `moduleResolution: "bundler"` and is unaffected.

This pre-flight step is expected to be removed in Phase 1+ when either (i) the root `typecheck` script is changed to build shared first or (ii) `apps/functions/tsconfig.json` switches `moduleResolution` to `"node16"` / `"bundler"` (decision deferred to Phase 1+ — see `agent-6-phase-0-report.md` recommendations).

## Pre-flight (every run, ≤60 seconds)

1. `git status` — working tree clean (or only contains the changes under review).
2. `pnpm install --frozen-lockfile` — exits 0; lockfile is in sync with `package.json`.

## Workspace smoke rows (~2–5 minutes total)

| # | Surface | Check | Expected result | Pass tag |
|---|---|---|---|---|
| W-1 | Workspace globs resolve | `pnpm list --depth -1 --json` (or `pnpm m ls`) | Includes at least: `web`, `functions`, `@ejm/shared`, `@ejm/tests`. Any future sync-study packages (`@ejm/shared-core`, `@ejm/shared-ui`, `@ejm/shared-functions`, `study-web`, `study-functions`) appear once Phase 1+ creates them. | Visual (CLI output) |
| W-2 | Workspace YAML parses | `cat pnpm-workspace.yaml` | File parses as YAML; `packages` key lists `packages/*`, `apps/*`, `tests`, `!apps/mobile`. | Visual |
| W-3 | Root scripts present | `pnpm run` | Lists at minimum: `dev`, `dev:study`, `build`, `build:study`, `build:functions`, `build:study-functions`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `seed:admin`, `emulators`, `deploy`. | Visual |
| W-4 | Study stubs print and exit 0 | `pnpm run dev:study && pnpm run build:study && pnpm run build:study-functions` | Each prints the Phase 3 placeholder echo line; combined chain exits 0. (Replace this row's check with the real `pnpm --filter` smoke once Phase 3 swaps the stubs for live commands.) | Log + exit code |
| W-5 | tsconfig parses and root typecheck green | `node -e "JSON.parse(require('fs').readFileSync('tsconfig.base.json','utf8'));console.log('ok')"` then `pnpm typecheck` | First prints `ok`; second exits 0 with no new TS errors vs. the previous green SHA. **Requires the fresh-worktree pre-flight (step 0) to have run at least once** — otherwise `apps/functions typecheck` fails on `@ejm/shared` resolution. | Log + exit code |
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
