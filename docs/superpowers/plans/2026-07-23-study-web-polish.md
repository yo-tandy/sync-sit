# Study-Web UX Polish (Hardening PR H5 — sweep closer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** four quality items closing the hardening sweep: (1) the tutor sessions page refetches after a recurring confirm so the new instances appear without a reload; (2) completed sessions prompt the family to endorse the tutor (the hook the `completed` status exists for); (3) `.env.development` for study-web so local dev against emulators stops needing inline env vars; (4) route-level code-splitting to cut the ~1MB single chunk.

**Deliberately OUT (ledgered, not this PR):** notification emailSent/pushSent accuracy (informational fields, cross-cutting churn); live onSnapshot lists (bigger design choice); tutor area editing.

**Templates:** tutor SessionsPage (the respond flow + the PR-5 note about the missing refetch); family SessionsPage History section; EndorseTutorDialog + the family RequestsPage endorse wiring (entry-point + session-endorsed-set pattern to reuse); vite.config in study-web + router.tsx (lazy() candidates); the smoke-era inline env vars (VITE_FIREBASE_PROJECT_ID=demo-test VITE_FIREBASE_STORAGE_BUCKET=demo-test.appspot.com) for .env.development.

## Task 1: refetch-after-confirm (tutor SessionsPage)
- After a successful respondToSession confirm (both types), re-run the page's load (sessions + instances) instead of only the local status flip — the recurring result dialog stays as-is; the Upcoming section now shows the series WITH its instances immediately.
- Tests: after a mocked recurring confirm resolves, getDocs is called again and the new instances render (deferred-promise idiom); one_time confirm also refetches; a FAILED confirm does NOT refetch.
- Commit: `fix(study-web): sessions refetch after confirm so new instances appear`

## Task 2: endorse-after-completion prompt (family SessionsPage)
- History section: completed sessions (one_time parents; and series with ≥1 completed instance) whose tutor is not yet endorsed by this family show an 'Endorse {tutorName}' button opening EndorseTutorDialog (reuse the component + the RequestsPage session-endorsed-set pattern; subject prefilled from the session). Query the family's existing endorsements once (submittedByFamilyId==mine, appSource=='study' — the provable RequestsPage query) to compute 'not yet endorsed'.
- Tests: completed+unendorsed → button; completed+already-endorsed tutor → no button; non-completed → no button; dialog payload carries the session's tutorUserId+subject; endorsed-set updates after success.
- Commit: `feat(study-web): endorse prompt on completed sessions`

## Task 3: .env.development
- apps/study-web/.env.development with the demo-test emulator values (VITE_FIREBASE_PROJECT_ID=demo-test, VITE_FIREBASE_STORAGE_BUCKET=demo-test.appspot.com) + a comment; verify vite mode semantics (dev only — production builds unaffected; CI builds pass explicit env so unaffected either way). Confirm apps/web has or lacks the same convention — do NOT touch apps/web.
- Test: none beyond a build check (env files aren't unit-testable); document in the report that `pnpm --filter study-web dev` now hits emulators with zero inline vars.
- Commit: `chore(study-web): .env.development for emulator-backed local dev`

## Task 4: route-level code-splitting
- router.tsx: React.lazy + Suspense (house Spinner fallback) for the heavy route components (SearchPage, BookSessionPage, both SessionsPages, EndorsementsPage, enrollment wizard steps if they're routed — READ the router; split by route, not micro-chunks). Keep AuthGuard/layouts eager.
- Gates: production build shows multiple chunks with the main chunk substantially reduced (report before/after sizes); ALL page tests still green (lazy components need Suspense-aware tests — vitest handles lazy via findBy* awaits; fix any test that breaks on async mounting rather than un-lazying the page).
- Commit: `perf(study-web): route-level code splitting`

## Task 5: gates + push
- Full study-web suite + typecheck + lint baseline + production build; FULL emulator suite unchanged (no backend changes — baseline post-#96 is 541/63). Push feat/study-web-polish. NO PR.
