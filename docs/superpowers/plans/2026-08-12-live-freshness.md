# Live Freshness (UX F3 / issue #117) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the stale-open-tab problem (issue #117). Two tiers, per the issue: (a) a shared refetch-on-focus hook applied to every hot list page in both apps; (b) real `onSnapshot` subscriptions on the requests surfaces, where a waiting user is most likely to have a tab open.

**Architecture:**
- **Tier (a)** — `useRefetchOnFocus(refetch, { minIntervalMs = 15000 })` in `packages/shared-ui/src/hooks/useRefetchOnFocus.ts` (new `hooks/` dir, exported from the package index): subscribes to window `focus` AND document `visibilitychange`→visible; calls `refetch` at most once per `minIntervalMs` (a returning user gets fresh data; rapid alt-tabbing doesn't hammer Firestore/callables). The `refetch` ref is kept current via a ref so pages can pass their existing load functions without memoization gymnastics. Cleanup on unmount. SSR-safe guards unnecessary (SPA) but keep listeners idempotent.
- **Tier (b)** — the requests pages replace their fetch-on-mount reads with `onSnapshot` on the SAME provable equality queries they already use (this repo's provability discipline: every list query carries the equality constraints that prove its read rule — keep the exact `where` args, they are test-pinned). Loading state resolves on first snapshot; `loadError` state on the error callback (these pages already have loadError from the provability work); unsubscribe on unmount. Callable-sourced data on those pages (if any) keeps tier (a).

**Both tiers preserve the house rules:** non-optimistic mutations stay; query where-args stay byte-identical (page tests pin them); study-web lint ZERO; sit lint baseline 1 error/7 warnings, add none; i18n untouched (no new strings expected).

---

## Task 1: the hook (TDD)

Files: `packages/shared-ui/src/hooks/useRefetchOnFocus.ts` (new), export from package index; test in whichever app's test tree already unit-tests shared-ui helpers (`apps/study-web/src/__tests__/shared-ui/` — follow `callableErrors.test.ts`'s placement) using `@testing-library/react`'s `renderHook`.

Red-first cases:
1. firing window `focus` calls refetch once;
2. a second `focus` inside `minIntervalMs` does NOT call again (fake timers);
3. after the interval elapses, `focus` calls again;
4. `visibilitychange` to visible triggers (and to hidden does not);
5. unmount removes listeners (focus after unmount → no call);
6. the LATEST refetch closure is used (swap the callback via rerender, assert the new one fires).

Commit: `feat(shared-ui): useRefetchOnFocus hook`

## Task 2: tier (b) — live requests pages

Files (verify each page's current reads before editing):
- `apps/study-web/src/pages/tutor/RequestsPage.tsx` — contact requests (`studyContactRequests` where `tutorUserId==uid`) and pending session requests: convert the Firestore list reads to `onSnapshot` (one subscription per query), first-snapshot resolves loading, error callback sets the existing loadError, unsubscribe on unmount. Where a read is via callable instead of Firestore, leave it fetch-based and cover it with tier (a) on the same page.
- `apps/study-web/src/pages/family/RequestsPage.tsx` — same treatment for the family's outgoing requests reads.
- `apps/web/src/pages/babysitter/RequestsPage.tsx` (locate exact path) — sit babysitter pending appointment requests: same conversion.

Tests: these pages' existing tests mock `firebase/firestore` — extend the mocks with an `onSnapshot` that (a) captures the query args so THE EXISTING WHERE-ARG PINS KEEP WORKING (adapt pins, do not delete), (b) lets the test push an initial snapshot and then a SECOND snapshot, asserting the new row renders WITHOUT any refetch/navigation (the live-update pin — the point of this issue); (c) returns an unsubscribe spy asserted on unmount. Red-first for the live-update pin on each page.

Commit: `feat(web,study-web): requests pages update live via onSnapshot`

## Task 3: tier (a) — hook rollout on hot lists

Wire `useRefetchOnFocus` to the primary load function of (verify each page's loader shape; skip any page converted fully to onSnapshot in Task 2):
- study-web: family `SessionsPage`, family `DashboardPage`, family `GovernancePage`, tutor `SessionsPage`, tutor `DashboardPage`, family `RequestsPage`/tutor `RequestsPage` for any remaining callable-sourced sections.
- web (sit): babysitter dashboard + requests remnants, family `DashboardPage`, family requests/appointments list page (locate the sit equivalents; wire whatever function each page already uses for initial load).

Tests: one representative page test per app pinning the behavior (initial load once → dispatch `window.dispatchEvent(new Event('focus'))` after advancing fake timers past the interval → loader called again with IDENTICAL args). Don't test all pages — the hook is unit-tested; page tests pin the wiring pattern once per app plus any page with non-obvious loader shape.

Commit: `feat(web,study-web): refetch hot lists on window focus`

## Task 4: gates

`pnpm typecheck && pnpm build`; study-web + web test/lint/build (lint baselines: study ZERO, sit exactly 1 error/7 warnings); FULL tests/integration + tests/rules (should be untouched — this PR is client-only; run to prove it; baseline 811/82 if branched after #133's merge — this branch is off main so expect 810/82? VERIFY the actual baseline with a clean run first and report the number you started from).

## Self-review notes

- The where-arg pins are load-bearing (provability discipline): conversions must keep query construction byte-identical.
- onSnapshot error → loadError, never an empty list masquerading as success (that's the exact bug class the provability work fixed).
- The hook must not double-fire when focus AND visibilitychange arrive together (same throttle window covers it — pin in the unit test).
- No new indexes: same queries, new transport.
