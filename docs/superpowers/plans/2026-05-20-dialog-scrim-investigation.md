# Dialog Scrim Regression — Investigation + Conditional Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the reported Dialog backdrop scrim regression (content bleeds through where a 50% black scrim should dim it) on the smallest possible change set, and unblock PR #45 merge.

**Architecture:** The reported root cause (Tailwind v4 `@theme` block in `packages/shared-ui/src/theme/base.css` stripped the default `--color-black` / `--color-white` palette) is **refuted by direct evidence from the existing dist bundle** (see Investigation Findings below). Therefore the plan diagnoses-first, escalates the finding to team-lead, and only ships a defensive minimal fix to `Dialog` + `PhotoLightbox` if team-lead re-confirms the bug reproduces against a fresh build.

**Tech Stack:** Tailwind CSS v4.2.2 (via `@tailwindcss/vite`), Vite 8, React 19, pnpm workspace, `@ejm/shared-ui` package.

---

## Investigation Findings (already complete — read before approving plan)

I read the relevant files end-to-end and inspected the most recently built CSS bundle. Here is what the evidence shows:

### What the brief says is broken
- `bg-black/50` in `packages/shared-ui/src/components/Dialog.tsx` resolves to a missing/empty color.
- Cause: the `@theme {}` blocks in `packages/shared-ui/src/theme/base.css` + `sit.css` may have replaced (not extended) Tailwind's default palette, so `--color-black` is undefined.
- Evidence cited: `grep "rgb(0"` on the dist CSS returned zero matches.

### What the bundle actually contains
Inspected file: `/Users/yoav/TandY/EJM-Babysitter-app/apps/web/dist/assets/index-CWmYcoZ6.css` (33 229 bytes, built 2026-05-15 — post-extraction, current `Dialog.tsx`).

1. The bundle has exactly one declaration of `--color-black`, in `:root,:host`:
   ```css
   :root,:host{ ...;--color-gray-950:oklch(13% .028 261.692);--color-black:#000;--color-white:#fff;--spacing:.25rem; ... }
   ```
   It is inherited site-wide. Nothing in `apps/web/src`, `packages/shared-ui/src`, or `packages/shared-core/src` references `color-black` or `color-white` to override or unset it.

2. The `bg-black/50` utility is emitted as a TWO-rule cascade (Tailwind v4 standard for opacity utilities):
   ```css
   .bg-black\/50{background-color:#00000080}
   @supports (color:color-mix(in lab, red, red)){
     .bg-black\/50{background-color:color-mix(in oklab, var(--color-black) 50%, transparent)}
   }
   ```
   - Fallback (non-color-mix browsers): `#00000080` — that is hex for `rgb(0 0 0 / 50%)`. Working 50% black.
   - Modern browsers: `color-mix(in oklab, var(--color-black) 50%, transparent)` with `--color-black: #000` ≈ 50% black.

3. The same is true for `bg-black/80` (used by `PhotoLightbox.tsx`): `#000c` fallback + color-mix path, both valid.

### Why the original grep returned zero
Tailwind v4 outputs the fallback in **hex-with-alpha** form (`#00000080`), not legacy `rgb(0 0 0 / 0.5)`. So `grep "rgb(0"` was searching for a string Tailwind v4 never emits for this utility. The grep result was a false negative, not a missing color.

### Conclusion
The CSS pipeline is producing a fully-formed `bg-black/50` rule with a working 50% black value. The "extend defaults / add black+white to `@theme`" root fix described in the brief is a **no-op against current code** — those tokens are already present in the bundle via Tailwind's `@theme default { … }` (in `node_modules/.pnpm/tailwindcss@4.2.2/node_modules/tailwindcss/theme.css` lines 322-323), which `@import "tailwindcss"` brings in automatically, and `@theme {}` blocks merge with (not replace) it.

### What could still be wrong despite a correct bundle
Listed in order of probability:

1. **Stale dev-server CSS / browser cache** at the time of the screenshot. The user saw the bug on May-19/20 against a dev server that the previous session had been mutating; HMR + theme file `@import` rearrangements can leave a Vite CSS module out of sync until a hard refresh.
2. **Different bundle served than the one inspected.** The dist file I read was built 2026-05-15. If the user is viewing a separate build, that build would need to be checked.
3. **Real, but caused elsewhere** — e.g. a regression that hides `Dialog`'s scrim child via something other than `bg-black/50` (extra wrapper introduced upstream, conditional rendering, CSS specificity in app-level styles, browser-specific color-mix handling on iOS Safari prior to 16.4). I've not found evidence for any of these in the current source tree.

---

## File Structure

The plan only touches code if a defensive fix is approved at the checkpoint. Files involved would be:

- **Modify:** `packages/shared-ui/src/components/Dialog.tsx` — line 28 (scrim div). Replace `bg-black/50` with an arbitrary-value class so the scrim is independent of token resolution.
- **Modify:** `packages/shared-ui/src/components/PhotoLightbox.tsx` — line 30 (full-screen scrim). Same treatment for `bg-black/80` (out of scope per brief, but listed since the brief asks about "cross-Dialog implications").

No theme-CSS changes (Hypothesis 1 is refuted). No Dialog structural changes (Hypothesis 2 is not supported by source inspection — the scrim/content stacking is well-formed).

---

## Task 1 — Diagnostic Checkpoint (no code change yet)

**Files:** none (status / comms work)

- [ ] **Step 1: Send findings to team-lead**

Send the Investigation Findings section above to team-lead via SendMessage. Request:
  - Confirm the bug still reproduces after a hard refresh (Cmd-Shift-R) against a freshly built bundle, OR
  - Approve the defensive fix (Task 2) ship-and-merge despite the diagnostic, on the theory that a hardcoded scrim color is cheaper than another reproduction round, OR
  - Mark the issue closed-not-reproducible and proceed to PR #45 merge with no code change.

- [ ] **Step 2: Wait for team-lead decision**

Stand by. Do not modify code, do not run the gate, do not push. Possible decisions and what they trigger:
  - **"Confirmed still broken"** → proceed to Task 2.
  - **"Ship defensive fix anyway"** → proceed to Task 2.
  - **"Closed, not reproducible"** → close this branch with no commit; delete the worktree per team-lead instruction.

---

## Task 2 — Defensive Scrim Fix (only if Task 1 ends in proceed)

**Files:**
- Modify: `packages/shared-ui/src/components/Dialog.tsx:28`
- Modify: `packages/shared-ui/src/components/PhotoLightbox.tsx:30`

**Rationale for arbitrary-value class over `@theme` edit:** the `@theme` edit is a no-op (token already present). An arbitrary-value class emits a literal hex color into the generated utility, removing any dependence on token resolution at runtime. One line per file. No new CSS, no new file, no rebuild of the shared-ui design system.

- [ ] **Step 1: Pre-flight install + build in this worktree**

Run:
```bash
cd /Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-dialog-scrim
pnpm install
pnpm -r --filter './packages/**' build
```
Expected: install completes; both `@ejm/shared-core` and `@ejm/shared-ui` build successfully (no tsc errors).

- [ ] **Step 2: Edit Dialog.tsx**

Change `Dialog.tsx` line 28 from:
```tsx
<div className="fixed inset-0 bg-black/50" />
```
to:
```tsx
<div className="fixed inset-0 bg-[rgb(0_0_0/0.5)]" />
```

This emits a literal `background-color: rgb(0 0 0 / 0.5)` in the generated CSS, independent of `--color-black`. No other Dialog change.

- [ ] **Step 3: Edit PhotoLightbox.tsx scrim**

Change `PhotoLightbox.tsx` line 30 from:
```tsx
className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
```
to:
```tsx
className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/0.8)] p-4"
```

(Same defensive rationale; the lightbox uses the same `bg-black/<n>` pattern.)

- [ ] **Step 4: Run gate — typecheck + build + lint**

Run (from worktree root):
```bash
pnpm typecheck && pnpm build && pnpm lint
```
Expected: all three pass with the same green status as `3eae638`. Capture the tail of each command's output for the team-lead reply.

- [ ] **Step 5: Verify the arbitrary class is in the new bundle**

Run:
```bash
grep -o "bg-\\[rgb(0_0_0/0\\.5)\\][^}]*}" apps/web/dist/assets/index-*.css | head -3
grep -o "bg-\\[rgb(0_0_0/0\\.8)\\][^}]*}" apps/web/dist/assets/index-*.css | head -3
```
Expected: each grep returns a `.bg-[rgb(0_0_0/0.5)]{background-color:rgb(0 0 0 / 0.5)}` (or hex equivalent) rule.

- [ ] **Step 6: Commit**

Commit message follows Conventional Commits, no Co-Authored-By trailer, no emoji:
```bash
git add packages/shared-ui/src/components/Dialog.tsx packages/shared-ui/src/components/PhotoLightbox.tsx
git commit -m "fix(shared-ui): pin Dialog and PhotoLightbox scrim to literal rgb so they survive any token regression"
```

- [ ] **Step 7: Push branch**

```bash
git push -u origin feature/sync-study-dialog-scrim
```
Expected: push succeeds; remote tracking is set.

- [ ] **Step 8: Report to team-lead**

SendMessage to team-lead containing:
  - Files changed (Dialog.tsx, PhotoLightbox.tsx)
  - Root-cause one-liner: "Investigation refuted the original `@theme` hypothesis (dist bundle already contains a working `bg-black/50` rule with `#00000080` fallback). Shipped a defensive arbitrary-value scrim instead so the colour cannot regress with any future theme reshuffle."
  - Gate output (typecheck/build/lint pass)
  - Push confirmation (branch + remote SHA)
  - Cross-Dialog implications: only `Dialog` and `PhotoLightbox` use `bg-black/<n>` in the entire repo (`grep -rn "bg-black" apps/web/src packages/shared-ui/src` confirms two hits, both covered).

---

## Self-Review

**Spec coverage** (against the brief):

- "Confirm the bug from code (don't run the app)" → Investigation Findings section, dist bundle inspection. ✓
- "Find the root cause" → Identified the original diagnosis as a false signal from a wrong-format grep; logged refutation evidence. ✓
- "Propose a fix; prefer root fix over band-aid" → Original "root fix" would be a no-op against current bundle; documented why, and proposed minimal defensive change as the only ship-worthy alternative if reproduction is reconfirmed. ✓
- "Write a plan via writing-plans, SendMessage to team-lead, wait for approval" → Plan written, will be sent now, Task 1 ends with a wait. ✓
- "Pre-flight (install + build packages) before any typecheck" → Task 2 Step 1. ✓
- "Gate: typecheck && build && lint" → Task 2 Step 4. ✓
- "Conventional Commit message, no Co-Authored-By, no emoji" → Task 2 Step 6 spec. ✓
- "Push and report files changed / root cause / gate / push / cross-Dialog implications" → Task 2 Steps 7-8. ✓
- "Permission-prompt heads-up to team-lead if blocked" → not pre-scheduled; will be sent ad-hoc if Task 2 Step 1 stalls on a prompt. ✓

**Placeholder scan:** no TBDs, no "implement later", every code step shows the exact change. ✓

**Type consistency:** the change is JSX className strings only; no types/methods cross-referenced across tasks. ✓
