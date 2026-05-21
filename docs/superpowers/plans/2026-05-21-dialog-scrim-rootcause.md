# Dialog Scrim Regression — Tailwind v4 Content-Scan Root-Cause Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tailwind v4 scan `packages/shared-ui/src/**` for utility classes so that classes used only inside shared-ui components (`inset-0`, `bg-black/50`, `bg-black/80`, and any others) are emitted in the apps/web CSS bundle. Single-line fix in `packages/shared-ui/src/theme/base.css`. Replaces (and supersedes) the defensive-fix plan at `docs/superpowers/plans/2026-05-20-dialog-scrim-investigation.md`.

**Architecture:** Tailwind CSS v4 via `@tailwindcss/vite` performs automatic content detection rooted at the directory containing the CSS that imports `tailwindcss`. In this monorepo that root is `apps/web/src/`, so `packages/shared-ui/src/**` is out of scan range. The Tailwind v4 escape hatch is the `@source "..."` CSS directive, with paths resolved relative to the file that declares it. Putting `@source` inside `packages/shared-ui/src/theme/base.css` co-locates the scan declaration with the package that owns the classes, so any consumer of `@ejm/shared-ui/theme/base.css` (apps/web today, sync-study tomorrow) inherits the right scan paths without per-app config drift. Verdict from tailwind-design-system: this is the canonical v4 cross-package source-registration pattern; replacing it with arbitrary values, hard-coded styles, or a Tailwind v3-style `tailwind.config.ts` would be inferior on every axis (per-app drift, larger blast radius, departs from v4 idiom).

**Tech Stack:** Tailwind CSS v4.2.2, `@tailwindcss/vite@^4.2.2`, Vite 8.0.1, pnpm workspaces, React 19.2.

---

## Root-Cause Evidence (already gathered — read once before approving plan)

Inspected the smoke-branch fresh build at:

`/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-tester-phase1-smoke/apps/web/dist/assets/index-BrA_8R2q.css`

Findings:

| Class / token | In bundle? | Why |
|---|---|---|
| `.fixed{position:fixed}` | yes | Also used in apps/web/src/* |
| `.z-50{z-index:50}` | yes | Also used in apps/web/src/* |
| `.bg-red-600{background-color:var(--color-red-600)}` | yes | Used in AppBar.tsx |
| **`.inset-0`** | **NO** | Used only in Dialog.tsx + PhotoLightbox.tsx (both in shared-ui) |
| **`.bg-black\/50`** | **NO** | Used only in Dialog.tsx (shared-ui) |
| **`.bg-black\/80`** | **NO** | Used only in PhotoLightbox.tsx (shared-ui) |
| **`--color-black`** | **NO** | Tailwind v4 only emits theme tokens referenced by generated utilities; no `bg-black` utility was generated, so the token is suppressed |

Source cross-check (run from this worktree):

```bash
grep -rn "inset-0\|bg-black" apps/web/src packages/shared-ui/src
```

→ Zero hits in `apps/web/src/`. Three hits in `packages/shared-ui/src/components/`: Dialog.tsx lines 25 + 28, PhotoLightbox.tsx line 30. Confirms the scan-miss hypothesis.

**Why my earlier "bundle is fine" verdict was wrong:** I inspected `/Users/yoav/TandY/EJM-Babysitter-app/apps/web/dist/assets/index-CWmYcoZ6.css` (May-15 22:36). That timestamp pre-dates the Dialog (commit `2df97ae`, 2026-05-18 12:44) and PhotoLightbox (commit `bd1e121`, 2026-05-18 12:39) extractions, so the components still lived in `apps/web/src/components/ui/` at build time and Tailwind scanned them. The smoke-branch bundle is the first dist built fully post-extraction and tells the real story.

**Why Playwright sees the scrim as "hidden":** with `.inset-0` not generated, the scrim div has only `position: fixed` (from `.fixed`). With `top/right/bottom/left` all defaulting to `auto` and no content inside the self-closing div, the fixed box collapses to zero width × zero height. Playwright's `toBeVisible()` rejects on the zero bounding box. Independently, `.bg-black\/50` not being generated means the element would be transparent even if it had area. Both failures stack — matches the screenshot.

---

## File Structure

The fix touches exactly one file plus a verification grep.

- **Modify:** `packages/shared-ui/src/theme/base.css` — add `@source` directive(s) to register shared-ui source tree with Tailwind v4 content detection.
- **No change:** `apps/web/src/index.css`, `apps/web/vite.config.ts`, `Dialog.tsx`, `PhotoLightbox.tsx`, any other source file.

---

## Task 1 — Pre-flight install + build packages in this worktree

This worktree (`sync-study-dialog-scrim`) has no `node_modules` yet. Required before any pnpm command can run.

**Files:** none (environment setup).

- [ ] **Step 1: Install workspace dependencies**

Run from the worktree root:
```bash
cd /Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-dialog-scrim
pnpm install
```
Expected: pnpm completes; workspace links are set up; no peer-dep errors that weren't already present on `3eae638`.

- [ ] **Step 2: Build packages so apps/web typecheck can resolve workspace imports**

```bash
pnpm -r --filter './packages/**' build
```
Expected: `@ejm/shared-core` and `@ejm/shared-ui` both build green.

---

## Task 2 — Add Tailwind `@source` directive to shared-ui's base theme

**Files:**
- Modify: `packages/shared-ui/src/theme/base.css` (add three lines below the existing `@theme {}` block / file header).

- [ ] **Step 1: Apply the edit**

Insert a `@source` directive at the top of the file, immediately under the header comment and above the `@theme {}` block. Path is relative to base.css's location (`packages/shared-ui/src/theme/`).

After edit, the top of `packages/shared-ui/src/theme/base.css` reads:

```css
/* ═══════════════════════════════════════════
   @ejm/shared-ui — BASE THEME TOKENS
   App-agnostic. Imported by both sync-sit and sync-study.

   NOTE: this file does NOT @import "tailwindcss" — each app's
   entry CSS owns that import (because Tailwind needs to resolve
   against the app's own node_modules under pnpm's hoisting).
   This file contributes only @theme tokens + reset.

   Tailwind v4 source registration: by default @tailwindcss/vite
   only scans files under the importing app's CSS root. Files in
   this package live outside that root, so we register them here.
   Any consumer of @ejm/shared-ui/theme/base.css inherits this scan
   automatically — no per-app config drift.
   ═══════════════════════════════════════════ */

@source "../**/*.{ts,tsx}";

@theme {
  ...
```

Concretely the only change is: insert a blank line plus `@source "../**/*.{ts,tsx}";` plus a blank line between the closing `*/` of the header comment and the `@theme {` line. The header comment may be updated as shown above to document why the directive lives here.

The `../` resolves to `packages/shared-ui/src/`, so the glob covers every `.ts` and `.tsx` file in the package (components, forms, schedule, index files).

- [ ] **Step 2: Sanity-check no other CSS files need the same**

Confirm `apps/web/src/index.css` has not changed (still just three lines: `@import "tailwindcss"`, `@import "@ejm/shared-ui/theme/base.css"`, `@import "@ejm/shared-ui/theme/sit.css"`). Run:
```bash
cat apps/web/src/index.css
```
Expected: unchanged three-line file. If it has changed, abort and re-investigate.

---

## Task 3 — Rebuild and verify dropped utilities are restored

**Files:** none (verification only — the build writes to `apps/web/dist/`).

- [ ] **Step 1: Build apps/web with the fix in place**

```bash
pnpm --filter web build
```
Expected: build completes; new CSS bundle written under `apps/web/dist/assets/index-*.css`. Note the new filename (Vite content-hashes; will differ from `CWmYcoZ6`).

- [ ] **Step 2: Grep the new bundle for the three previously-dropped utilities and the token**

```bash
CSS=$(ls apps/web/dist/assets/index-*.css | head -1)
echo "=== .inset-0 ==="
grep -oE '\.inset-0\{[^}]*\}' "$CSS"
echo "=== .bg-black\\/50 ==="
grep -oE '\.bg-black\\\\/50\{[^}]*\}' "$CSS"
echo "=== .bg-black\\/80 ==="
grep -oE '\.bg-black\\\\/80\{[^}]*\}' "$CSS"
echo "=== --color-black ==="
grep -oE '\-\-color-black:[^;]*' "$CSS"
```
Expected output for each grep: a single non-empty match (`.inset-0{inset:calc(var(--spacing) * 0)}`, `.bg-black\/50{background-color:#00000080}`, `.bg-black\/80{background-color:#000c}`, `--color-black:#000`). If any returns empty, abort and re-investigate.

- [ ] **Step 3: Pre-vs-post bundle class diff (canonical casualty audit)**

Compare the smoke-branch's pre-fix bundle (built against the same `3eae638` source state but without the `@source` directive) to my new post-fix bundle. Every class in the diff that the smoke bundle did NOT have, but the new bundle DOES, is a silent casualty of the extraction that this fix restores.

```bash
PRE=/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-tester-phase1-smoke/apps/web/dist/assets/index-BrA_8R2q.css
POST=$(ls /Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-dialog-scrim/apps/web/dist/assets/index-*.css | head -1)

extract_classes() {
  grep -oE '\.[a-zA-Z][a-zA-Z0-9_:/\.\\\-\[\]]*\{' "$1" | sed 's/\{$//' | sort -u
}

echo "=== pre  count: $(extract_classes "$PRE" | wc -l)"
echo "=== post count: $(extract_classes "$POST" | wc -l)"
echo "=== classes added by fix (recovered casualties) ==="
diff <(extract_classes "$PRE") <(extract_classes "$POST") | grep "^>" | sed 's/^> //'
echo "=== classes lost by fix (should be empty) ==="
diff <(extract_classes "$PRE") <(extract_classes "$POST") | grep "^<" | sed 's/^< //'
```

Expected:
  - "classes added by fix": MUST include `.inset-0`, `.bg-black\/50`, `.bg-black\/80`, and likely several more (team-lead seeded candidates: StepIndicator, DateTag, Avatar, Chip, Badge, WeeklyTimeline, DayEditor, OverrideList, PhoneInput, AddressAutocomplete, CodeInput, LanguagePicker — any unique sizes / padding / ring / focus-border utilities they use).
  - "classes lost by fix": MUST be empty. `@source` only ADDS scan paths; nothing should drop.

Capture the "added" list in full for the team-lead report. If "classes lost by fix" is non-empty, abort and re-investigate.

---

## Task 4 — Full gate

**Files:** none (gate run only).

- [ ] **Step 1: Run typecheck + build + lint per project plan §7**

```bash
pnpm typecheck && pnpm build && pnpm lint
```
Expected: all three green, identical-or-better to `3eae638` baseline. Tail of each command's output captured for the team-lead report.

If any of the three regresses, the fix is reverted (just remove the `@source` line) and the task re-investigated.

- [ ] **Step 2: apps/web vitest suite (40 tests baseline)**

```bash
pnpm --filter web test -- --run
```
Expected: 40 passed, 0 failed. If the count differs, identify why before continuing; the fix shouldn't touch any code path under test, so a regression here would be a setup issue.

---

## Task 5 — Commit

**Files:**
- Already-staged: `packages/shared-ui/src/theme/base.css`.

- [ ] **Step 1: Stage and commit**

```bash
git add packages/shared-ui/src/theme/base.css
git commit -m "fix(shared-ui): register shared-ui src tree for Tailwind v4 content detection

The Phase 1 extraction moved Dialog and PhotoLightbox out of
apps/web/src/, but @tailwindcss/vite only scans files under the
importing app's CSS root by default. Classes used only inside
shared-ui (inset-0, bg-black/50, bg-black/80) silently stopped
being emitted, collapsing the Dialog scrim to a zero-box,
transparent div. Add @source directive in base.css with a path
relative to that file, so every app importing @ejm/shared-ui/theme
inherits the right scan paths."
```

No Co-Authored-By trailer. No emoji. Conventional Commits prefix.

---

## Task 6 — Push branch

**Files:** none (remote push).

- [ ] **Step 1: Push with upstream tracking**

```bash
git push -u origin feature/sync-study-dialog-scrim
```
Expected: push succeeds; remote tracking set.

---

## Task 7 — Report to team-lead with hand-off for Playwright acceptance

**Files:** none (SendMessage).

Playwright acceptance (the team-lead-prescribed verifier — S-1 FAIL → PASS, S-2 PASS, S-4 PASS) runs in the **tester-phase1-smoke** worktree, not this one. That worktree already has `@playwright/test`, `playwright.config.ts`, and the `tests-e2e/` specs. Keeping this branch clean (one `@source` line, no test infrastructure) means the Playwright run happens post-push as a natural rebase/merge of the smoke branch on top of the fix.

- [ ] **Step 1: Send report**

SendMessage to team-lead with:
- Files changed: `packages/shared-ui/src/theme/base.css` (one `@source` line added + updated header comment).
- Root-cause one-liner: "Tailwind v4 (@tailwindcss/vite) doesn't scan files outside the app's CSS root by default; the Phase 1 extraction silently dropped inset-0, bg-black/50, bg-black/80 (and likely other shared-ui-only utilities) from the bundle. Restored via @source directive in shared-ui's base.css."
- Gate output (typecheck/build/lint pass, three tail snippets).
- apps/web vitest result (40/40 PASS expected).
- Bundle verification (Task 3 Step 2 outputs — the four classes/tokens now present).
- Casualty audit (Task 3 Step 3 outputs — full list of classes added by the fix).
- Push confirmation (branch + remote SHA).
- Hand-off block with EXACT commands for the Playwright acceptance run in the smoke worktree:
  ```bash
  cd /Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-tester-phase1-smoke
  git fetch origin
  git rebase origin/feature/sync-study-dialog-scrim   # pull in the one-line fix
  pnpm install                                         # no-op if lockfile unchanged
  pnpm -r --filter './packages/**' build
  # If the existing dev server (bash bg id b4x0ekfov) is running against
  # an older source state, restart it so the Vite CSS module picks up
  # the new @source directive:
  #   pnpm --filter web dev
  npx playwright test tests-e2e/s1-admin-dialog-scrim.spec.ts \
                     tests-e2e/s2-endorsement-dialog.spec.ts \
                     tests-e2e/s4-photo-lightbox.spec.ts
  ```
  Expected: S-1 flips FAIL → PASS, S-2 PASS, S-4 PASS. S-3 (modify-appointment) and the rest of Tier A should also be exercised once Playwright greenlights the Dialog pattern.
- Note: agent-8c's chrome-control S-1 diagnostic dump is parallel belt-and-suspenders; the analysis already explains the symptom and predicts the chrome-control output (zero bbox + no `background-color` rule on the scrim node).

- [ ] **Step 2: Stand by**

Wait for team-lead's decision on whether the fix rolls into PR #45 or ships as Phase 1.1. Don't touch the branch further.

---

## Self-Review

**Spec coverage** (against team-lead's hold-and-revise brief + the three items from the pre-approval):

- "Hold execution until S-1 diagnostic dump lands" → Plan is written; execution gated on team-lead approval, not in motion. Static analysis already identified the cause.
- "Re-investigate root cause, likely candidates: parent display:none / zero bbox / z-index / clip-path" → Found: zero bounding box, but caused by missing `.inset-0` utility (not a parent). Documented in Root-Cause Evidence.
- "Write a REVISED plan via writing-plans + tailwind-design-system. Send it to me. Wait for approval before code edits." → Done; both skill stacks consulted (tailwind-design-system confirms `@source` is the canonical v4 cross-package source-registration pattern); no code touched yet.
- "Fix may NOT live in Dialog.tsx" → Confirmed; fix lives in `packages/shared-ui/src/theme/base.css`.
- "Pre-flight install + build packages before typecheck" → Task 1.
- "Gate: typecheck && build && lint" → Task 4 Step 1.
- "Conventional Commit, no Co-Authored-By, no emoji" → Task 5.
- "Push, report files / root-cause / gate / push / cross-Dialog implications" → Tasks 6-7.

Three pre-approval items folded in:

- **(1) Grep scope — multi-class casualty audit** → Task 3 Step 3 replaced with a smoke-bundle-vs-new-bundle class diff using the team-lead-suggested approach (adapted for minified single-line CSS). Output enumerates every recovered casualty, not just the three I already knew about.
- **(2) Acceptance gate — Playwright + apps/web vitest** → Task 4 Step 2 adds the apps/web vitest run (40-test baseline). Playwright S-1/S-2/S-4 happens in the smoke worktree post-push because that worktree owns the test infrastructure (keeps this fix branch single-purpose). Task 7 Step 1 hand-off block has the exact commands.
- **(3) Chrome-control confirmation (don't block)** → Task 7 Step 1 notes the analysis predicts the chrome-control dump's findings (zero bbox + no background-color rule on the scrim node); execution does not wait on it.

**Placeholder scan:** every step has the exact command or exact code to write. No TBDs.

**Type / path consistency:** the only path that needs to be right is `../**/*.{ts,tsx}` relative to `packages/shared-ui/src/theme/base.css`. Verified: `..` from there is `packages/shared-ui/src/`, which is the intended scan root.
