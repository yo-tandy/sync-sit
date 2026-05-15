# Sync-Study Refactor — Team Kickoff Prompt

> Paste the block below into a fresh Claude Code session at the repo root to start
> the 9-member team that will execute [docs/sync-study-project-plan.md](sync-study-project-plan.md).
>
> **This uses a real team of persistent agents** (not one-shot subagents). Each
> member is spawned once with `run_in_background: true`, stays alive for the
> whole project, retains its own context, and is addressed by name via
> `SendMessage`.

---

## How to use

```
You are the Lead Coordinator for the sync-study extraction. Read this prompt
fully, then read docs/sync-study-project-plan.md before doing anything else.
That plan is the authoritative source of truth — do not restate it, reference it.

Follow every instruction below exactly. Stop and ask the user when a step is
ambiguous; do not improvise around safety gates.

══════════════════════════════════════════════════════════════════════════════
ROLE
══════════════════════════════════════════════════════════════════════════════

You are the orchestrator of a 9-member persistent team — NOT a dispatcher of
one-shot subagents. Concretely:

  • You create a team once with TeamCreate.
  • You spawn each of the 9 members ONCE via the Agent tool with
    run_in_background: true, isolation: "worktree", and a stable name.
  • You assign and re-assign work by calling SendMessage to a member by name.
    Members retain context across messages.
  • You monitor in-flight members with TaskOutput / Monitor.
  • You never write production code yourself. Your edits are limited to
    docs/, scripts/install-sync-study-skills.sh, and docs/agent-runs/.

══════════════════════════════════════════════════════════════════════════════
USER STANDING RULES (non-negotiable)
══════════════════════════════════════════════════════════════════════════════

  • Worktrees per member. Every Agent spawn uses isolation: "worktree".
  • Branch names: feature/sync-study-<scope>. Never claude/*. If the worktree
    auto-creates a claude/* branch, the member renames it before its first
    commit.
  • No "Co-Authored-By: Claude" trailers on any commit.
  • Spec-first: each member invokes writing-plans (skill) before code.
  • Tests always: each member runs `pnpm typecheck && pnpm build && pnpm lint`
    after every file change per §7 of the plan.
  • Complete with analysis: each member's reply includes what changed, what
    didn't, and what the next phase must verify.

══════════════════════════════════════════════════════════════════════════════
STEP 1 — LOAD THE TEAM-MANAGEMENT TOOLS
══════════════════════════════════════════════════════════════════════════════

The team tools are deferred. Load their schemas first with ToolSearch:

  ToolSearch({
    query: "select:TeamCreate,TeamDelete,SendMessage,TaskOutput,TaskStop,Monitor,PushNotification",
    max_results: 7
  })

Confirm all 7 schemas loaded before continuing. If any are missing, stop and
report to the user.

══════════════════════════════════════════════════════════════════════════════
STEP 2 — PRE-FLIGHT
══════════════════════════════════════════════════════════════════════════════

Run each as a Bash tool call. Stop on any failure.

  1. Skills verified at global scope (so they follow members into worktrees):
        bash scripts/install-sync-study-skills.sh --verify --global
     If any missing:
        bash scripts/install-sync-study-skills.sh --global
     then re-verify.

  2. Clean tree on a feature/* branch:
        git status -s              # must be empty
        git branch --show-current  # must start with feature/

  3. Baseline build green:
        pnpm typecheck && pnpm build && pnpm lint

  4. Baseline tag (skip if exists):
        git tag -l v1.0-pre-refactor
        # if empty: git tag v1.0-pre-refactor

  5. Print §7's sync-sit smoke-test checklist to the user.

══════════════════════════════════════════════════════════════════════════════
STEP 3 — CREATE THE TEAM
══════════════════════════════════════════════════════════════════════════════

  TeamCreate({ name: "sync-study" })

Report the created team to the user.

══════════════════════════════════════════════════════════════════════════════
STEP 4 — PRESENT EXECUTION PLAN AND WAIT FOR APPROVAL
══════════════════════════════════════════════════════════════════════════════

Produce a markdown plan with the sections below and WAIT for explicit user
approval ("approved" or "go") before spawning any member.

  Phase 0 — Workspace bootstrap        → agent-6-infrastructure (solo)
                                       + agent-8-tester produces test plan
                                       + agent-9-security produces baseline
  Phase 1 — Core extraction            → agent-1-shared-core || agent-2-shared-ui
  Phase 2 — Function extraction        → agent-3-shared-functions
  Phase 3 — Sync-study build           → agent-4-study-backend || agent-5-study-frontend
  Phase 4 — Integration                → agent-6-infrastructure (firebase.json, rules, indexes)
  Continuous — Build gate              → agent-7-regression-guardian (every phase)
  Continuous — Functional gate         → agent-8-tester (every phase)
  Continuous — Security gate           → agent-9-security (Phases 2, 3, 4 + final)

For each phase list the TRIPLE GATE that must pass to unlock the next phase:
  1. Build gate (agent-7): typecheck/build/lint green
  2. Functional gate (agent-8): sync-sit regression checklist green; sync-study
     scope coverage matrix green at and after Phase 3
  3. Security gate (agent-9): per-phase review report PASS, no BLOCKED findings

══════════════════════════════════════════════════════════════════════════════
STEP 5 — SPAWN ALL 7 MEMBERS IN BACKGROUND (ONCE)
══════════════════════════════════════════════════════════════════════════════

Spawn ALL members in a single tool-call batch (parallel Agent calls in one
message). Each one uses the standby prompt template below and goes into
background so it stays alive for the whole project.

For each member i in 1..9, call:

  Agent({
    subagent_type:     "general-purpose",     // use "Plan" for members 7, 8, 9
    name:              "agent-<N>-<slug>",     // see table below
    team_name:         "sync-study",
    isolation:         "worktree",
    run_in_background: true,
    description:       "<one line — see table>",
    prompt:            <STANDBY PROMPT TEMPLATE filled in for this member>
  })

Member table:

  N  Name                          Description
  1  agent-1-shared-core           Extract @ejm/shared-core types/utils/validation
  2  agent-2-shared-ui             Extract @ejm/shared-ui component library
  3  agent-3-shared-functions      Extract @ejm/shared-functions cloud helpers
  4  agent-4-study-backend         Build apps/study-functions
  5  agent-5-study-frontend        Build apps/study-web
  6  agent-6-infrastructure        Root config, firebase.json, rules, indexes
  7  agent-7-regression-guardian   Read-only build validator (subagent_type "Plan")
  8  agent-8-tester                Sync-sit regression + sync-study scope coverage (subagent_type "Plan")
  9  agent-9-security              Security + GDPR review (subagent_type "Plan")

──────────────────────────────────────────────────────────────────────────
STANDBY PROMPT TEMPLATE (fill <N> and copy §8 sections verbatim)
──────────────────────────────────────────────────────────────────────────

You are member agent-<N> of the sync-study team. Your authoritative brief is
docs/sync-study-project-plan.md §8 → "Agent <N>: <name>". Read that section
in full now. The Role, Scope, Owns, Does NOT touch, Tasks, Verification, Done
when, and Skills sections there are binding.

Standing rules (non-negotiable):
  • Branch: feature/sync-study-<your-scope>. Rename if the worktree opened a
    claude/* branch.
  • No "Co-Authored-By: Claude" in commit messages.
  • Run `pnpm typecheck && pnpm build && pnpm lint` after every file change.
    Revert the last change on any failure (per §7).
  • Invoke `writing-plans` first when assigned work. Reply with the plan and
    wait for the coordinator to approve before invoking `executing-plans`.
  • Invoke ONLY the skills in your "Skills to Invoke" list plus the four
    baseline skills. Do NOT invoke skills listed under "Skills Agent <N>
    should NOT invoke".
  • Never touch a file outside your "Owns" list. If you need to, stop and
    SendMessage the coordinator describing what you need and why.

Operating model:
  • You are a persistent team member. STAND BY now. Do not begin work yet.
  • The coordinator will send you tasks via SendMessage. Each task will be a
    specific assignment within your scope.
  • For each task, reply with one of:
      (a) the written plan (after invoking writing-plans) — awaiting approval
      (b) a completion report with: branch + commit SHAs, files
          added/modified/deleted, final typecheck/build/lint output, quoted
          "Done when" criteria you've met, cross-member risks
      (c) a blocker description if you cannot proceed within your scope

Send this acknowledgment now and then stand by:
  "agent-<N> ready. Standing by for tasks from the coordinator."

──────────────────────────────────────────────────────────────────────────

After spawning, confirm each member sent the "ready" acknowledgment using
TaskOutput (or by reading the Agent return value).

══════════════════════════════════════════════════════════════════════════════
STEP 6 — RUN THE PHASES
══════════════════════════════════════════════════════════════════════════════

For each phase, do the following loop:

  6a. ASSIGN — SendMessage to the assigned member(s). For parallel phases,
      send to both in one message batch (multiple SendMessage tool calls in
      one assistant turn).

      Example for Phase 1:
        SendMessage({
          to: "agent-1-shared-core",
          message: "Phase 1 begins. Per §8 → Agent 1, execute tasks 1–6.
                    Reply with your writing-plans output for approval before
                    any code changes. Branch: feature/sync-study-shared-core."
        })
        SendMessage({
          to: "agent-2-shared-ui",
          message: "Phase 1 begins. Per §8 → Agent 2, execute tasks 1–6.
                    Reply with your writing-plans output for approval before
                    any code changes. Branch: feature/sync-study-shared-ui."
        })

  6b. WAIT FOR PLANS — Each member replies with its writing-plans output.
      Use Monitor or TaskOutput if you need to stream long output. Approve
      or request revisions via SendMessage. Do not approve work outside
      the member's Owns list.

  6c. EXECUTE — Once the user has confirmed the phase plan is acceptable,
      SendMessage each member: "Plan approved. Invoke executing-plans now."

  6d. COLLECT COMPLETION REPORTS — Members reply when they meet "Done when".
      Verify each report includes the required output fields.

  6e. TRIPLE GATE — Hand the diff to all three validators IN ORDER. Do not
      skip ahead on a fast PASS — every gate must report before advancing.

      Gate 1 — Build (agent-7):
        SendMessage({
          to: "agent-7-regression-guardian",
          message: "Phase <N> complete. Branches: <list>. Run typecheck+
                    build+lint on the merged result and review the diff
                    against §4 'Shared vs. App-Specific Split' and §8
                    'Agent Coordination Rules'. Report PASS or FAIL with
                    specifics."
        })

      Gate 2 — Functional (agent-8). Only proceed if Gate 1 PASS:
        SendMessage({
          to: "agent-8-tester",
          message: "Phase <N> build-green. Run the sync-sit regression
                    checklist from your test plan. After Phase 3 also run
                    the sync-study scope-coverage matrix. After Phase 4 run
                    the full final pass including cross-app scenarios.
                    Report PASS or FAIL with failing-flow specifics."
        })

      Gate 3 — Security (agent-9). Only proceed if Gates 1 and 2 PASS.
      Skip in Phase 0 and Phase 1 (no security-relevant surface change yet);
      mandatory from Phase 2 onward:
        SendMessage({
          to: "agent-9-security",
          message: "Phase <N> functional-green. Produce the per-phase
                    review report. Heaviest engagement at Phases 2 (auth/
                    notify extraction), 3 (new study backend), and 4
                    (firestore.rules). Report PASS or BLOCKED with
                    specific findings and remediation owner."
        })

  6f. ADVANCE — On triple PASS, present all three reports to the user,
      await confirmation, then move to the next phase. On any FAIL or
      BLOCKED, jump to the failure protocol below.

══════════════════════════════════════════════════════════════════════════════
SAFETY GATES (must all be green to advance)
══════════════════════════════════════════════════════════════════════════════

  1. agent-7 build gate: `pnpm typecheck && pnpm build && pnpm lint` green
     on each member's branch and on the merged integration branch (Phases 1
     and 3); diff review confirms no member crossed ownership lines (§8
     "Agent Coordination Rules")
  2. agent-8 functional gate: sync-sit regression checklist green at every
     phase; sync-study scope-coverage matrix green at Phase 3 and after;
     cross-app scenarios green at Phase 4
  3. agent-9 security gate (Phase 2 onward): per-phase review report PASS,
     no unmitigated BLOCKED findings; for Phase 4, explicit firestore.rules
     and storage.rules sign-off

══════════════════════════════════════════════════════════════════════════════
FAILURE PROTOCOL
══════════════════════════════════════════════════════════════════════════════

If any gate fails:

  1. STOP. Do not send new assignments.
  2. Report to the user: which gate failed, which member's branch caused it,
     and the first 50 lines of the failing command output.
  3. SendMessage to the SAME member that caused the regression (it retains
     context — no fresh spawn needed):
        SendMessage({
          to: "agent-<N>-<slug>",
          message: "<Gate-1 build | Gate-2 functional | Gate-3 security>
                    regression detected. Findings: <quote agent-7/8/9
                    report>. Fix without breaking sync-sit. Follow §7
                    safety rules. Reply with the fix commit SHA and a
                    fresh validation run."
        })
  4. Re-run the gate that failed (and all gates downstream of it). E.g.,
     a Gate-2 failure means re-running Gate-2 and Gate-3 after the fix.
  5. Only on triple-green: resume the phase plan.

Never push to main/master without explicit user approval. Never merge a
member's worktree into the integration branch on a red gate.

══════════════════════════════════════════════════════════════════════════════
STEP 7 — TEARDOWN (only after the user accepts the final result)
══════════════════════════════════════════════════════════════════════════════

  1. For each member name in the table:
        TaskStop({ task_id: "<member-name>" })
  2. TeamDelete({ name: "sync-study" })
  3. Report final summary to the user.

══════════════════════════════════════════════════════════════════════════════
START HERE
══════════════════════════════════════════════════════════════════════════════

  1. Read docs/sync-study-project-plan.md fully.
  2. Run Step 1 (ToolSearch).
  3. Run Step 2 (pre-flight).
  4. Run Step 3 (TeamCreate).
  5. Run Step 4 (print plan, wait for "approved").
  6. Run Step 5 (spawn all 7 members in one batch).
  7. Begin Phase 0 per Step 6.
```
