# Sync-Study Extraction — Status Snapshot

**As of:** 2026-05-20
**Author:** session that ran Phase -1 through Phase 1, ending with comms breakdown
**Purpose:** complete handoff to a fresh Claude Code session

---

## Where the project actually is

| Phase | State | Branch / PR | Notes |
|---|---|---|---|
| **Phase -1** (lint + sync-sit security fixes + Phase 0 baselines) | ✓ merged to main | PR #43 (`feature/sync-study-orchestration` → main) | 111 → 0 lint errors; firestore.rules tightened for BL-1, BL-2 (½), BL-3, BL-4; UX publish-button hide; agent-8 test plan + agent-9 security baseline shipped. Tag `v1.0-pre-refactor` set on the orchestration HEAD before this PR (commit `9e78daf`). |
| **Phase 0** (workspace bootstrap) | ✓ merged to main | PR #44 | Three sync-study echo-stub scripts in root `package.json`; three new docs in `docs/agent-runs/agent-6-phase-0-*`; agent-9 minor-reviews log opened. |
| **Phase 1** (shared-core + shared-ui extraction) | **PR open, CI green, NOT yet merged** | PR #45 | 109 files / +5597 / -3219. shared-core created with ServiceProviderBase abstract; shared-ui with 20 of 23 §8-listed components; theme tokens split (base.css + sit.css + study.css); `packages/shared` is a thin shim. Triple gate PASS (agent-7 build / agent-8 functional / agent-9 security). Visual smoke surfaced one bug — see "Known issues" below. |
| **Phase 2** (shared-functions extraction) | not started | — | agent-3 is the owner. Tasks listed below. |
| **Phase 3** (sync-study apps) | not started | — | agent-4 + agent-5. |
| **Phase 4** (firestore.rules + firebase.json + indexes) | not started | — | agent-6. |

Local repo state when this snapshot was written:

- Main branch HEAD: `ae43585` (PR #44 merge commit)
- `feature/sync-study-orchestration` local HEAD: `3eae638` (Phase 1 work + tsconfig hotfix; this is the head of PR #45)
- Branch worktrees alive: see `git worktree list | grep sync-study`

## What's merged into `main` right now

In chronological order of merge:

1. PR #43 (`01ae4db`) — Phase -1 batch
2. PR #44 (`ae43585`) — Phase 0 workspace bootstrap

PR #45 (Phase 1) is still open and ready to merge pending visual smoke approval.

## Known issues / open items

### Phase 1 — confirmed visual regression to investigate before merging PR #45

**Dialog backdrop scrim is missing.** User confirmed via screenshot: on the admin dashboard (or any page using `Dialog` from `@ejm/shared-ui`), opening the menu (hamburger top-right) shows the dashboard content bleeding through where the dark scrim should dim it. The Dialog component code at `packages/shared-ui/src/components/Dialog.tsx` is byte-identical to the pre-Phase-1 version in main; the regression has to be in the CSS pipeline.

Investigation so far:
- The class `bg-black\/50` IS in the built CSS bundle (verified via grep on `apps/web/dist/assets/index-*.css`).
- But `grep "rgb(0"` returned zero matches in the built CSS, suggesting the value the class resolves to may not be `rgb(0 0 0 / 0.5)` as expected.
- Hypothesis 1: Tailwind v4 + the `@theme` block split between `apps/web/src/index.css` (3 lines now, just imports) and `packages/shared-ui/src/theme/base.css` + `sit.css` may have lost the default `black`/`white` palette because the `@theme` blocks replace rather than extend defaults.
- Hypothesis 2: Z-index stacking issue introduced when CSS was reorganized.

This bug likely affects EVERY use of Dialog in the app (endorsement dialog, modify-appointment dialog, photo lightbox uses similar pattern). Browser smoke wasn't completed to confirm scope. Fix lives in either:
- The Dialog component (explicit fallback color instead of `bg-black/50`), or
- The theme CSS (add `black`/`white` to the `@theme` block), or
- The Tailwind config (extend rather than replace defaults).

### Phase 1 — three components deferred from extraction (intentional)

`AppBar`, `EnrollmentAppBar`, `PushPrompt` were NOT extracted to shared-ui (per agent-2's Q1 decision during Phase 1 planning). They're too coupled to sync-sit specifics: `@/stores/authStore` (Zustand), `@/config/firebase`, `@/lib/pushNotifications`, hard-coded sync-sit nav routes. Extracting as-is would force shared-ui to depend on the Firebase client SDK.

Phase 5 will need a headless/props refactor that touches three layouts + App.tsx + one enrollment page. Out of scope for the current plan; documented in agent-2's Phase 1 report.

**Implication for Agent 5 (sync-study frontend)**: build a fresh sync-study `AppBar` / `EnrollmentAppBar` / `PushPrompt` from the extracted Tier 1+2 shared-ui primitives. Do NOT try to share these three files with sync-sit.

### Security baseline carry-forward items

In `docs/agent-runs/agent-9-security-baseline.md` §7:

- **[BLOCK-LATER-5]** — `references` create rule cannot verify submitter↔babysitter relationship in Firestore-rule language. Needs a callable that does an `appointments` lookup. Mitigated by the forced `status: 'private'` on create (BL-3 closure).
- **[BLOCK-LATER-6]** — No legitimate path to promote a manual reference to `'published'` after Phase -1's BL-4 closure. The previous `publishReference()` was the fraud vector; UI button is already hidden via Phase -1 ux-publish-hide. Needs an admin/peer-approval-gated callable.
- **[WATCH-15]** — Withdrawn. The rules-test harness at `tests/rules/` DOES exist (31 tests). The original baseline was wrong; corrected via commit `4f5d171`. Lesson encoded in §1 (inventory methodology) and §8 (per-phase review item 6).
- **[WORKING-AS-INTENDED-1]** — `users.searchable` is intentionally user-controlled (babysitter self-toggle). `users.status` is the hard ban gate; admin's `blockUser` callable owns it.
- **[WORKING-AS-INTENDED-2]** — rules-test harness exists (correcting WATCH-15).

### Phase 2 readiness gates

Before Phase 2 starts:

- Either merge PR #45 first (cleanest baseline), OR document that Phase 2 starts from `3eae638` directly and acknowledges Phase 1 is unmerged.
- The Dialog scrim bug should be resolved either before merging PR #45 or as the first item of Phase 1.1 cleanup (depending on severity assessment).

### Apps/functions tsconfig — permanent fix deferred

`apps/functions/tsconfig.json` still uses `moduleResolution: "node"` (the classic Node10 resolver). This requires `packages/shared-core/dist/` to exist before `apps/functions` typecheck can resolve `@ejm/shared-core`. Phase 1's hotfix (`bc6a15a`) worked around this in CI by changing the workflow to build all packages in `packages/**` before typecheck.

Permanent fix options (defer to Agent 3 or Agent 6 in Phase 2):
- **(i)** Root `package.json` script: `"typecheck": "pnpm --filter @ejm/shared* build && pnpm -r typecheck"` — Agent 6 territory; one-line change.
- **(ii)** Flip `apps/functions/tsconfig.json` `moduleResolution` to `"node16"` — Agent 3 territory (apps/functions owner); makes it resolve from source via the `exports` field.

Recommended: (ii), aligned with Agent 3's natural touch to apps/functions during shared-functions extraction.

## Team roster state

The previous session created a team named `sync-study` at `~/.claude/teams/sync-study/`. All 9 members were spawned and several are now in unrecoverable wedged states (see "Comms breakdown" below).

Roster:

| Member | Branch | Worktree | State |
|---|---|---|---|
| `agent-1-shared-core` | `feature/sync-study-shared-core` | `.claude/worktrees/sync-study-shared-core` | **Wedged** — waiting on permission_request approvals from 2026-05-19. Work was applied directly by team-lead; should reset to origin/main. |
| `agent-2-shared-ui` | `feature/sync-study-shared-ui` | `.claude/worktrees/sync-study-shared-ui` | Done with Phase 1 work; idle. |
| `agent-3-shared-functions` | `feature/sync-study-shared-functions` | `.claude/worktrees/sync-study-shared-functions` | Standing by for Phase 2 (never started). |
| `agent-4-study-backend` | `feature/sync-study-backend` | `.claude/worktrees/sync-study-backend` | Standing by for Phase 3. |
| `agent-5-study-frontend` | `feature/sync-study-frontend` | `.claude/worktrees/sync-study-frontend` | Standing by for Phase 3. |
| `agent-6-infrastructure` | `feature/sync-study-infrastructure` (deleted; merged via PR #44) | recreated at `.claude/worktrees/sync-study-infrastructure` off origin/main | Standing by for Phase 4. |
| `agent-7-regression-guardian` | `feature/sync-study-regression-guardian` | `.claude/worktrees/sync-study-regression-guardian` | Standing by for next gate. |
| `agent-8-tester` | `feature/sync-study-agent-8-tester` | `.claude/worktrees/sync-study-agent-8-tester` | **Wedged** — same comms issue. |
| `agent-9-security` | `feature/sync-study-agent-9-security` | `.claude/worktrees/sync-study-agent-9-security` | Done with Phase 1 review; idle. |
| `agent-8b-tester` | `feature/sync-study-agent-8b-tester` | `.claude/worktrees/sync-study-agent-8b-tester` | Spawned as replacement for agent-8; immediately wedged on permission_request. |

The previous session also spawned three Phase -1 ad-hoc members that were shut down cleanly: `lint-cleanup`, `security-fix`, `ux-publish-hide`. Branches deleted from remote.

## Worktrees alive on disk

```
/Users/yoav/TandY/EJM-Babysitter-app                                                  feature/sync-study-orchestration
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-shared-core         feature/sync-study-shared-core
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-shared-ui           feature/sync-study-shared-ui
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-shared-functions    feature/sync-study-shared-functions
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-backend             feature/sync-study-backend
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-frontend            feature/sync-study-frontend
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-infrastructure      feature/sync-study-infrastructure
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-regression-guardian feature/sync-study-regression-guardian
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-agent-8-tester      feature/sync-study-agent-8-tester
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-agent-8b-tester     feature/sync-study-agent-8b-tester
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-agent-9-security    feature/sync-study-agent-9-security
```

All branches except `agent-8-tester` and `agent-8b-tester` are at HEAD `ae43585` (origin/main = post-PR-44) or have already-merged Phase 1 work.

## Dev environment (currently running in background)

- **Firebase emulators**: started via `pnpm emulators` (root). Bash background ID was `b8t11sisa` in the previous session. Likely still running.
- **Vite dev**: started via `pnpm --filter web dev`. Bash background ID was `b4x0ekfov`.
- **Seeded test data** in emulators (all passwords `test1234`):
  - Admin: `admin@syncsit.test`
  - Parents (Family Dupont, co-parented): `marie.dupont@test.com`, `pierre.dupont@test.com`
  - Parent (Family Martin, single): `sophie.martin@test.com`
  - Babysitters (active): `lea.bernard@ejm.org`, `hugo.leroy@ejm.org`, `camille.moreau@ejm.org`
  - Babysitter (inactive — should not appear in search): `tom.petit@ejm.org`

Seed scripts: `apps/functions/seed-test-data.cjs` (test data), `apps/functions/seed-admin.cjs` (admin only).

If the dev env isn't running in the new session, restart with:
```bash
# Terminal 1
pnpm emulators
# Terminal 2 (after emulators are ready)
node apps/functions/seed-test-data.cjs
# Terminal 3
pnpm --filter web dev
```

## Comms breakdown — what failed and why

The previous session lost the ability to communicate with team members via `SendMessage`. Diagnosed:

1. **Outbound from team-lead → agent inbox**: works. Messages successfully queue in `~/.claude/teams/sync-study/inboxes/<agent>.json`.
2. **Wake signal**: doesn't propagate from `SendMessage`. Agents only wake when the user pings them from the Claude Code UI (the "direct ping" mechanism).
3. **Inbound from agent → team-lead inbox**: works at the filesystem level. Messages appear in `~/.claude/teams/sync-study/inboxes/team-lead.json`.
4. **Auto-delivery from team-lead inbox → my conversation**: BROKEN. Messages queue with `read: false` but are never surfaced in the team-lead's conversation context. Manual polling via `cat | jq` is the only way to see them.
5. **`permission_response` from team-lead → agent**: NOT SUPPORTED. The `SendMessage` schema only accepts `shutdown_response` and `plan_approval_response` as structured types; `permission_response` is rejected by validation. The only working channel for permission approvals is the user's UI.

**Net effect**: agents froze when their first tool-use triggered a permission_request because the team-lead couldn't approve. The user could approve via UI, but the message never made it back to team-lead's awareness, so I'd assume the agent was wedged and try to work around it (re-spawn, send more messages, etc.) when in reality the work had been done.

This pattern recurred at least with `agent-1-shared-core` and `agent-8-tester`. A fresh session will avoid the legacy queued state and can establish a different per-turn discipline (poll inbox, plus explicit user-approval workflow for permission requests).

## Standing rules to carry forward (verbatim)

- **Branch names**: `feature/sync-study-<scope>`. Never `claude/*`. Rename auto-created `claude/*` branches before first commit.
- **No "Co-Authored-By: Claude"** trailers on any commit.
- **No emoji** in commits or code (unless explicitly requested).
- **Spec-first**: each member invokes `writing-plans` skill before code.
- **Tests after every file change**: `pnpm typecheck && pnpm build && pnpm lint` per §7 of the project plan. On failure, revert the last change.
- **Rules harness**: run `tests/rules/` (31 tests baseline) after any `firestore.rules` or `storage.rules` change. Invocation:
  ```
  pnpm install --filter "@ejm/tests..."
  npx -y firebase-tools@latest emulators:exec --project demo-test --only firestore,auth,storage \
    'pnpm --filter @ejm/tests exec vitest run rules/'
  ```
- **Fresh-worktree pre-flight**: `pnpm install` + `pnpm -r --filter './packages/**' build` before any typecheck (per agent-6's smoke-test doc).
- **Worktrees per member**: manually pre-create via `git worktree add` before spawning (the `isolation: "worktree"` flag combined with `team_name` was unreliable in the previous session).

## Phase 1 PR — what to do with it

Recommended approach for a fresh session:

1. Open PR #45 (`https://github.com/yo-tandy/sync-sit/pull/45`).
2. Check CI status — should be green at `3eae638`.
3. Decide whether to fix the Dialog scrim bug as part of PR #45 OR ship Phase 1 as-is and treat the Dialog bug as Phase 1.1 cleanup.
4. Either way: complete the visual smoke (the Tier-A list in the previous session's analysis) before merging.

If the new session inherits a wedged agent-8 / agent-8b, the user has a working direct-ping channel from their UI. Encourage the new session to use that channel explicitly for permission approvals rather than trying `SendMessage` for permission responses.
