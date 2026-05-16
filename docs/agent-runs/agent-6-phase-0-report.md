# Phase 0 Workspace Bootstrap — agent-6 Completion Report

**Task:** #16
**Owner:** agent-6-infrastructure
**Branch:** `feature/sync-study-infrastructure`
**Baseline SHA:** `01ae4db` (post-PR-43 main)
**Plan:** [docs/agent-runs/agent-6-phase-0-plan.md](agent-6-phase-0-plan.md)
**Smoke-test doc:** [docs/agent-runs/agent-6-phase-0-smoke-test.md](agent-6-phase-0-smoke-test.md)

## Files changed

| File | Change |
|---|---|
| `package.json` | Added three echo-stub scripts: `dev:study`, `build:study`, `build:study-functions`. All other scripts unchanged. |
| `docs/agent-runs/agent-6-phase-0-plan.md` | New — implementation plan (v2 with team-lead's four additions). |
| `docs/agent-runs/agent-6-phase-0-smoke-test.md` | New — 7-row workspace-topology smoke checklist + fresh-worktree pre-flight. |
| `docs/agent-runs/agent-6-phase-0-report.md` | New — this file. |

## Files inspected, intentionally unchanged

| File | Reason for no change |
|---|---|
| `pnpm-workspace.yaml` | Existing `packages/*` and `apps/*` globs already cover the five future sync-study packages (`shared-core`, `shared-ui`, `shared-functions`, `study-web`, `study-functions`); `tests` entry preserved for the `@ejm/tests` rules harness added in Phase -1. §8's quoted spec omits `tests` because it pre-dates Phase -1; keeping `tests` overrides the literal spec text. |
| `tsconfig.base.json` | Compiler defaults only; no `paths`, no `references`. `moduleResolution: "bundler"` + each package's own `name` + `exports` in its own `package.json` is the resolution path. Adding root `paths` now would set up a dual source-of-truth with package `exports` and bake in §4's still-evolving import surface. Deferred to Phase 1 if shared-core extraction reveals a real gap. |
| `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `scripts/` | Out of scope for Phase 0 (§8 puts these in Phases 3–4). No diff. |

## Verification

### Pre-flight (one-time per fresh worktree)

```
$ pnpm --filter @ejm/shared build
> @ejm/shared@1.0.0 build .../packages/shared
> tsc -p tsconfig.cjs.json
```
Exit 0. `packages/shared/dist/` is now populated. (Source: agent-8 harness note N1, commit `d68a0a0`. Build artifacts are git-ignored, so each fresh worktree starts with empty `dist/`. Needed because `apps/functions/tsconfig.json` uses `moduleResolution: "node"` which reads compiled artifacts, not package `exports`.)

### `pnpm install` (after stub edit)

Last 5 lines:
```
│   Ignored build scripts: @firebase/util, protobufjs.                         │
│   Run "pnpm approve-builds" to pick which dependencies should be allowed     │
│   to run scripts.                                                            │
╰──────────────────────────────────────────────────────────────────────────────╯
Done in 2.9s using pnpm v10.13.1
```
Exit 0. `pnpm-lock.yaml` unchanged (the script-only diff does not perturb resolution).

### `pnpm typecheck`

Last 5 lines:
```
packages/shared typecheck$ tsc --noEmit
packages/shared typecheck: Done
apps/web typecheck$ tsc -b --noEmit
apps/functions typecheck$ tsc --noEmit
apps/functions typecheck: Done
apps/web typecheck: Done
```
Exit 0. All four workspaces green (`@ejm/shared`, `@ejm/tests`, `apps/web`, `apps/functions`).

### `pnpm build`

(Captured after commit A — see §"Post-commit verification" below.)

### `pnpm lint`

Pre-commit run, last 5 lines:
```
apps/web lint:   70:6  warning  React Hook useEffect has a missing dependency: 'fetchStatus'. Either include it or remove the dependency array  react-hooks/exhaustive-deps
apps/web lint: ✖ 7 problems (0 errors, 7 warnings)
apps/web lint: Done
```
Exit 0. 0 errors. 7 warnings — these are the same pre-existing exhaustive-deps warnings in unowned files; not part of agent-6's surface (they live in `apps/web/src/components/endorsements/` and `apps/web/src/pages/{babysitter,family}/`). Matches the Phase -1 lint-cleanup contract of "0 errors" exactly.

### Stub scripts smoke

```
$ pnpm run dev:study && pnpm run build:study && pnpm run build:study-functions
> ejm-babysitter-app@1.0.0 dev:study .../sync-study-infrastructure
> echo 'study-web not yet implemented; see Phase 3 of docs/sync-study-project-plan.md'
study-web not yet implemented; see Phase 3 of docs/sync-study-project-plan.md
> ejm-babysitter-app@1.0.0 build:study .../sync-study-infrastructure
> echo 'study-web not yet implemented; see Phase 3 of docs/sync-study-project-plan.md'
study-web not yet implemented; see Phase 3 of docs/sync-study-project-plan.md
> ejm-babysitter-app@1.0.0 build:study-functions .../sync-study-infrastructure
> echo 'study-functions not yet implemented; see Phase 3 of docs/sync-study-project-plan.md'
study-functions not yet implemented; see Phase 3 of docs/sync-study-project-plan.md
```
Exit 0.

### Rules-test harness

Correctly **skipped** — no diff in `firestore.rules`, `storage.rules`, or `firestore.indexes.json` this phase. The 41/41 baseline is uninvolved.

## Done-when (§8 Phase 0 step 1 + Phase 1 workspace setup)

- [x] `pnpm-workspace.yaml` verified to cover the five future sync-study packages via existing `packages/*` + `apps/*` globs. `tests` entry preserved.
- [x] Root `package.json` has sync-study build/dev scripts registered (`dev:study`, `build:study`, `build:study-functions`) as echo stubs pointing at Phase 3.
- [x] `tsconfig.base.json` reviewed; no Phase 0 change required (no `paths`, no `references`; `moduleResolution: "bundler"` + per-package `exports` is sufficient).
- [x] Sync-sit workspace-topology smoke-test checklist authored at `docs/agent-runs/agent-6-phase-0-smoke-test.md`. Complements (does not duplicate) agent-8's §4 user-facing regression matrix. Includes the fresh-worktree pre-flight (`pnpm --filter @ejm/shared build`) documented per agent-8 N1.
- [x] `pnpm typecheck && pnpm build && pnpm lint` all green after the one-time `pnpm --filter @ejm/shared build` pre-flight.
- [x] `pnpm install` re-resolves cleanly; lockfile unchanged.

## Phase 1+ recommendations

1. **Pick a permanent fix for the fresh-worktree typecheck issue.** Two options on the table (deferred per team-lead's δ direction; let Phase 1+ pick when the relevant config is being touched anyway):

   - **(i) Root `package.json` `typecheck` script.** Change `"typecheck": "pnpm -r typecheck"` to `"typecheck": "pnpm --filter @ejm/shared build && pnpm -r typecheck"`. agent-6 territory, one-line change. Costs ~1.5 s on every `pnpm typecheck` invocation even when `dist/` is already current.

   - **(ii) `apps/functions/tsconfig.json`.** Flip `moduleResolution` from `"node"` to `"node16"`. agent-3 territory; the change is invisible at runtime (CommonJS output unchanged) but removes the need for `@ejm/shared` to be pre-built. Slightly nicer because it eliminates the workaround entirely.

   My preference is **(ii)** — it removes the special case rather than papering over it. But (i) is faster to land if agent-3 is busy. **Decision deferred to Phase 1+.**

2. **Phase 3 swap of the echo stubs.** When `apps/study-web` and `apps/study-functions` are created, agent-6 swaps the three stub bodies from `echo '...'` to `pnpm --filter <pkg> <cmd>`. Three one-line edits.

3. **Smoke-test W-1 / W-3 / W-4 row updates** when new workspace members or root scripts are added (procedure documented in the smoke-test's "Maintenance" section).

## Risks for Phase 1+

- Phase 3 *must* remember to swap the echo stubs; failing to do so will leave `pnpm dev:study` silently no-oping. Mitigation: each stub's echo line names "Phase 3 of docs/sync-study-project-plan.md" so a Phase 3 grep on the plan path catches them.
- The fresh-worktree pre-flight (`pnpm --filter @ejm/shared build`) is a footgun for §8 members spawning into new worktrees. The smoke-test doc documents it as step 0; if a future member skips that doc, they'll re-discover the same typecheck failure I did and waste a round-trip. Mitigating action would be the Phase 1+ permanent fix above.
- If Phase 1's shared-core extraction surfaces a resolution edge case that `exports` alone can't cover, revisit the tsconfig `paths` question then — the deferral rationale (asymmetric retraction cost) is in the plan.

## Branch state

Two focused commits on `feature/sync-study-infrastructure` ahead of `01ae4db`:

- **Commit A** (config): `chore(workspace): stub sync-study build/dev scripts (Phase 0 bootstrap)` — `package.json` only, SHA `dcca169`.
- **Commit B** (docs): `docs(agent-6): add Phase 0 plan, workspace smoke-test, and completion report` — three docs under `docs/agent-runs/`. SHA reported in the agent-6 → team-lead hand-off SendMessage (this report is part of commit B, so its own SHA is not known at write-time).

Diffstat and full commit SHAs are included in the hand-off message.

## Hand-off

Ready for the triple gate: agent-7 (build), agent-8 (functional — expected light; no user-facing change), agent-9 (security — expected light; no rules/permissions surface touched).
