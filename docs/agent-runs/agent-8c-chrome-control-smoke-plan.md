# Tier-A Smoke via chrome-control MCP — Implementation Plan

> **Author:** agent-8c-tester
> **Date:** 2026-05-21
> **Branch:** `feature/sync-study-tester-phase1-smoke` (continue at HEAD `b1c5509`)
> **Supersedes:** `agent-8-phase-1-1-playwright-plan.md` (Playwright approach is RETIRED)
> **Canonical surfaces:** `agent-8-phase-1-1-smoke-checklist.md` (S-1..S-8 definitions are unchanged)

**Goal:** Execute the eight Tier-A smoke surfaces by driving the user's visible Chrome window via the `chrome-control` MCP, then produce a results report and a typed runbook other agents can replay.

**Architecture:** A typed step-manifest file at `tests-e2e/chrome-control-smoke.ts` enumerates every surface as a `Surface` object containing a `setup` (login + nav), an ordered `steps` array, and per-step `assertions`. Each step is exactly one chrome-control MCP call (`open_url`, `execute_javascript`, `get_page_content`, `get_current_tab`). Assertions are chained inside `execute_javascript` payloads so a single MCP round-trip returns `{pass: boolean, observed: ...}`, minimizing disruption to the user's Chrome window. The "runtime" is Claude Code + chrome-control MCP — there is no Node/Vitest runner. The file is structured so a future agent can `Read` it, iterate the `Surface` array, and issue the prescribed MCP calls.

**Tech Stack:** chrome-control MCP (10 tools, AppleScript-backed), TypeScript (for the typed manifest only — never executed as JS), Firebase emulator UI at `localhost:4000` for cross-referencing Firestore writes when an assertion requires it.

---

## Constraints, recorded up front

1. **chrome-control is NOT headless.** Each call visibly takes over the user's Chrome window. Minimize tab count, prefer reusing the current tab, batch DOM probes inside a single `execute_javascript`.
2. **Screenshot capability is uncertain.** `execute_javascript` returns whatever JSON the snippet evaluates to. Real DOM-to-image capture would require `html2canvas` or `chrome.tabs.captureVisibleTab` — neither is guaranteed available. **Fallback:** record `getComputedStyle` snapshots + `outerHTML` excerpts + `get_page_content` text as the observable evidence. We will attempt one canvas-based snapshot on S-1 only; if it fails, we proceed with structured-data evidence.
3. **Dev env is shared and running.** Do not restart vite, emulators, or anything else. Treat the running app as immutable infrastructure.
4. **S-1 is the gate.** After S-1 we MUST SendMessage team-lead before proceeding. The plan branches on the S-1 verdict.
5. **No "Co-Authored-By: Claude" trailer. No emoji. One commit at the end.**
6. **MacOS Automation permission prompts** may interrupt the first MCP call. If we see one, SendMessage team-lead and stop.

---

## File Structure

- Create: `tests-e2e/chrome-control-smoke.ts` — typed Surface manifest + shared helpers (login JS snippet, EN/FR toggle snippet, scrim-probe snippet). ~300-450 lines.
- Create: `docs/agent-runs/agent-8c-tier-a-smoke-results.md` — final results report (PASS/FAIL per surface + observed evidence + verdict).
- Modify: none. The committed `docs/agent-runs/agent-8-phase-1-1-smoke-checklist.md` is the canonical checklist and stays untouched.
- Untracked detritus from predecessor's Playwright work (`playwright.config.ts`, `tests-e2e/` Playwright specs, `package.json` + `pnpm-lock.yaml` adds of `@playwright/test`): **leave alone** in this commit. Team-lead can decide later whether to revert. We will NOT commit the Playwright additions.

---

## Task list

### Task 0: Sanity-probe chrome-control + the running dev server

**Files:** none yet.

- [ ] **Step 0.1:** `mcp__chrome-control__list_tabs` → confirm Chrome is reachable and identify any existing localhost:5173 tab.
- [ ] **Step 0.2:** `mcp__chrome-control__open_url` with `url: "http://localhost:5173/"` and `new_tab: false` (reuse existing tab if one is on localhost:5173, else new tab).
- [ ] **Step 0.3:** `mcp__chrome-control__execute_javascript` with `code: "JSON.stringify({title: document.title, url: location.href, hasReactRoot: !!document.getElementById('root')?.children.length})"`. Expected: title contains "ejm" or similar app brand, hasReactRoot true.
- [ ] **Step 0.4:** If any of the above fails (permission prompt, blank page, network error), SendMessage team-lead with the failure mode and STOP.

### Task 1: Draft the shared helpers + S-1 manifest in `tests-e2e/chrome-control-smoke.ts`

**Files:**
- Create: `tests-e2e/chrome-control-smoke.ts`

- [ ] **Step 1.1:** Write the file header with a doc comment explaining: (a) the file is a typed runbook, not an executable test, (b) the runtime is Claude Code + chrome-control MCP, (c) how to replay (Read the Surface array, issue the prescribed MCP calls).
- [ ] **Step 1.2:** Declare the `MCPCall` discriminated union and `Surface` interface:

```typescript
type MCPCall =
  | { tool: 'open_url'; url: string; new_tab?: boolean }
  | { tool: 'execute_javascript'; code: string; note: string }
  | { tool: 'get_page_content' }
  | { tool: 'get_current_tab' };

interface Step {
  description: string;
  call: MCPCall;
  expected: string; // human-readable assertion the agent verifies against the MCP response
}

interface Surface {
  id: string; // 'S-1' .. 'S-8'
  title: string;
  priority: 'P0';
  precondition?: string;
  steps: Step[];
}
```

- [ ] **Step 1.3:** Write the `signInAs(email, password)` JS snippet as a string constant. The snippet must: (a) navigate to `/` if not already there, (b) locate the email + password inputs by label or `name`, (c) fill + submit, (d) `await` until `location.pathname` changes off `/` (use `MutationObserver` with a 10s timeout). Return `{ok: boolean, finalPath: string, error?: string}`.
- [ ] **Step 1.4:** Write the `probeScrim(scrimSelector)` JS snippet as a string constant. Returns `{found: boolean, backgroundColor: string, opacity: string, zIndex: string, rectVisible: boolean, outerHtmlExcerpt: string}`.
- [ ] **Step 1.5:** Write the `toggleLanguage()` JS snippet. Locates the LanguageSelector in TopNav, clicks it, then asserts `<html lang>` flipped.
- [ ] **Step 1.6:** Write Surface S-1 with these steps:
    1. `open_url` http://localhost:5173/ (reuse tab)
    2. `execute_javascript` running `signInAs('admin@syncsit.test', 'test1234')`. Expected: `{ok: true, finalPath: '/admin'}` (or `/admin/*`).
    3. `execute_javascript` clicking the hamburger button. Snippet: `(() => { const btn = document.querySelector('.bg-red-600 button, .bg-red-600 [role="button"]') ?? Array.from(document.querySelectorAll('button')).find(b => b.closest('.bg-red-600')); if (!btn) return {found: false}; btn.click(); return {found: true, label: btn.getAttribute('aria-label') ?? btn.textContent?.trim()}; })()`. Expected: `found: true`.
    4. `execute_javascript` running `probeScrim('.fixed.inset-0.bg-black\\/50')`. Expected: `backgroundColor === 'rgba(0, 0, 0, 0.5)'` (PASS) or report observed value (FAIL).
    5. `execute_javascript` attempting one canvas-based snapshot of the menu open state. Snippet wraps `html2canvas` if available else falls back to returning `{captured: false, reason: 'no html2canvas'}`. We won't load html2canvas; we'll just probe `document.documentElement.outerHTML.length` and return that as a proxy. Real screenshot is a stretch goal.
    6. `get_page_content` to capture the visible text of the menu-open state into the results doc.
    7. `execute_javascript` sending an `Escape` key event to close the menu. Expected: scrim element removed from DOM.

### Task 2: Execute S-1 and checkpoint

- [ ] **Step 2.1:** Issue the S-1 MCP calls one by one, recording each response.
- [ ] **Step 2.2:** Compute the S-1 verdict: PASS iff scrim `backgroundColor === 'rgba(0, 0, 0, 0.5)'` AND ESC removes the scrim element from the DOM. Any other observed `backgroundColor` (e.g. `rgba(0, 0, 0, 0)` transparent, or fully opaque, or scrim absent) = FAIL.
- [ ] **Step 2.3:** SendMessage team-lead with:
    - Subject-style first line: `S-1 verdict: PASS|FAIL`
    - Observed `backgroundColor`, `opacity`, `zIndex`, `rectVisible`.
    - The hamburger button's `aria-label` / textContent (sanity check we clicked the right thing).
    - Whether ESC successfully closed the menu.
    - If we attempted a screenshot, the path or "skipped — no canvas API available".
    - Explicit ask: "Proceed with S-2..S-8 per plan, or override?"
- [ ] **Step 2.4:** STOP and wait for team-lead direction.

### Task 3: Author S-2..S-4 Dialog-pattern surfaces (conditional on S-1)

**Branch:**
- If team-lead says S-1 PASS → execute S-2, S-3, S-4 in sequence.
- If team-lead says S-1 FAIL → SKIP these (cascade defer per checklist) and jump to Task 4.

- [ ] **Step 3.1:** Append Surface S-2 (EndorsementDialog) to the manifest. Login as `marie.dupont@test.com`. Navigate to family submitted-endorsements. Click "Add endorsement" CTA. Probe scrim. Fill babysitter selection (Lea Bernard) + 20-char body. Submit. Verify Dialog dismisses. **Firestore verification** is deferred — we will instead use `get_page_content` to confirm a success state, and document the Firestore check as MANUAL since chrome-control cannot drive the emulator UI cleanly without disrupting the user further.
- [ ] **Step 3.2:** Execute S-2. Record result.
- [ ] **Step 3.3:** Append + execute Surface S-3 (modify-appointment). Login as `lea.bernard@ejm.org`, find a confirmed appointment, open Modify dialog, change endTime +30min, save. Verify Dialog dismisses + scrim correct.
- [ ] **Step 3.4:** Append + execute Surface S-4 (PhotoLightbox). Login as `marie.dupont@test.com`, run family search, click a result with a photo, click the photo. Probe lightbox open. ESC to close. Probe scroll-lock by reading `document.body.style.overflow` before/after.

### Task 4: Author + execute S-5..S-7 (independent of Dialog regressions)

- [ ] **Step 4.1:** Append Surface S-5 (SchedulePage WeeklyTimeline). Login as `lea.bernard@ejm.org`. Navigate to `/babysitter/schedule`. Probe: 7 day columns present, slot grid renders. Simulate drag-select via `mousedown`/`mousemove`/`mouseup` synthetic events on slots 32-35 of Tuesday. Click Save (or assert auto-save indicator). Reload page. Re-probe the four slots stayed highlighted. Firestore round-trip = MANUAL.
- [ ] **Step 4.2:** Execute S-5.
- [ ] **Step 4.3:** Append Surface S-6 (PhoneInput). Login as `marie.dupont@test.com` → Family → Account. Probe: country select defaults to +33. Type "06" via synthetic input events; assert displayed value === "6". Change select to +44; assert reformatting. Type "06" again under +44; assert displayed value === "06". Clear input; assert empty.
- [ ] **Step 4.4:** Execute S-6.
- [ ] **Step 4.5:** Append Surface S-7 (AddressAutocomplete). Same user; Family → Settings. Focus the address field. Type "10 rue de" via synthetic events. Wait up to 3000ms (polling every 200ms inside the JS snippet) for the suggestion dropdown. Click first suggestion. Assert input populates. Save form. Assert no error toast. Note: if Geoapify/Mapbox key is missing in dev, FAIL gracefully with that diagnosis surfaced.
- [ ] **Step 4.6:** Execute S-7.

### Task 5: S-8 enrollment — stretch only

- [ ] **Step 5.1:** Per the predecessor's plan, S-8 is `fixme` unless trivially repro-able. Trivially repro-able means: the verification code path works without us reading from Firestore emulator UI. Probe whether the StepVerify form has any test-helper to skip-verify in dev. If not, document S-8 as DEFERRED with reasoning, do not execute.

### Task 6: Author the results report

**Files:**
- Create: `docs/agent-runs/agent-8c-tier-a-smoke-results.md`

- [ ] **Step 6.1:** Header: PR, HEAD, branch, date, runner (agent-8c-tester via chrome-control MCP), supersedes Playwright plan.
- [ ] **Step 6.2:** Per surface (S-1..S-8): verdict (PASS / FAIL / DEFERRED / SKIPPED-by-cascade), observed evidence (computed style, key DOM states, page-content excerpts), and the agent's confidence note.
- [ ] **Step 6.3:** Overall verdict: GREEN / YELLOW / RED per the checklist's disposition rubric.
- [ ] **Step 6.4:** "Known gaps" section: anything not covered (Firestore round-trips, Storage uploads, screenshot capture) flagged as needing manual operator follow-up.

### Task 7: Commit

- [ ] **Step 7.1:** `cd` into the worktree.
- [ ] **Step 7.2:** `git status` — confirm the only intentional adds are `tests-e2e/chrome-control-smoke.ts` and `docs/agent-runs/agent-8c-*.md`. The predecessor's Playwright detritus stays uncommitted.
- [ ] **Step 7.3:** `git add tests-e2e/chrome-control-smoke.ts docs/agent-runs/agent-8c-chrome-control-smoke-plan.md docs/agent-runs/agent-8c-tier-a-smoke-results.md`
- [ ] **Step 7.4:** Commit with message (no trailer, no emoji):
    ```
    Add Tier-A smoke runbook + results driven via chrome-control MCP

    Supersedes the Playwright plan. Drives the user's visible Chrome
    window via the chrome-control MCP to execute S-1..S-7 of the
    Phase 1.1 Tier-A smoke checklist. S-8 deferred per predecessor.
    Results captured in agent-8c-tier-a-smoke-results.md.
    ```
- [ ] **Step 7.5:** `git log --oneline -3` to confirm.

---

## Self-Review

**Spec coverage:** S-1 through S-8 from the canonical checklist are each mapped to a Task or explicitly deferred with reasoning. The S-1-first checkpoint matches the brief. The deliverable artifacts (`tests-e2e/chrome-control-smoke.ts`, `docs/agent-runs/agent-8c-tier-a-smoke-results.md`) match the brief.

**Placeholder scan:** No "TBD" / "handle edge cases" / "similar to Task N". Each step names the exact MCP tool and the exact JS snippet's purpose.

**Type consistency:** `Surface`, `Step`, `MCPCall` declared once in Task 1.2 and referenced in every subsequent task. `signInAs`, `probeScrim`, `toggleLanguage` snippet names used consistently.

**Risk register:**
1. Chrome-control's `execute_javascript` may not handle very long code payloads cleanly — mitigation: pre-define snippets as top-level functions injected once per page, then call by name. If injection fails, fall back to inline IIFEs (uglier but reliable).
2. Synthetic input events on React-controlled inputs need `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, val)` + `input.dispatchEvent(new Event('input', {bubbles: true}))` — React's synthetic event system. We will use the React-aware setter form in S-6/S-7.
3. AppleScript permission prompts may fire on first MCP call — mitigation: if the first call blocks, SendMessage team-lead and stop.

---

## Execution Handoff

This plan executes inline in this agent session — there is no subagent dispatch. After plan approval from team-lead, Tasks 0..2 run, the S-1 checkpoint fires, then Tasks 3..7 run pending team-lead's S-1 verdict response.
