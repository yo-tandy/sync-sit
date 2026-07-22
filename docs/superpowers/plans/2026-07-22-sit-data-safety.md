# Sit Data-Safety Fixes (Hardening PR H1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** fix three long-ledgered sit-side defects, each already solved once on the study side — port the shipped fixes, don't invent: (1) the family-settings kid save clobbers `languages` cross-app; (2) the family account page writes top-level `email`, desyncing Firebase Auth; (3) `getValidGraduationYears` is TZ-flaky under non-UTC local time.

**Templates (the SHIPPED fixes to mirror):** apps/study-web/src/pages/family/FamilySettingsPage.tsx (kid updates deliberately OMIT the languages key — read its comment and tests); apps/study-web/src/pages/family/AccountPage.tsx (read-only login email + rationale comment; per-scenario notifPrefs dot-paths NOT in scope here — sit's page may already differ, only the email fix is in scope); the study test files for both pages (assertion idioms for "key NOT in payload").

**Invariants:** study-web untouched; smallest possible diffs in apps/web (these pages have no test coverage baseline like study's — ADD the minimal tests with the fix, mirroring study's); no behavior change beyond the three fixes; sit lint baseline (1 pre-existing router-level error + 7 hook-dep warnings — no new).

## Task 1: kid-languages clobber (apps/web FamilySettingsPage)
- Find the kid update payload in apps/web/src/pages/family/FamilySettingsPage.tsx; remove the `languages` key from UPDATE payloads exactly as study did (adds keep seeding `languages: []` for new kids — check what study does for adds and match). Port study's comment explaining the cross-app ownership.
- TDD: sit's family pages may have no test file — create the minimal one mirroring apps/study-web/src/pages/family/__tests__/FamilySettingsPage.test.tsx's "update omits languages" test (mock idioms per existing apps/web tests if any exist — READ what test setup apps/web uses; if none exists for pages, follow the study-web conventions with apps/web's vitest config).
- Commit: `fix(web): family kid updates no longer clobber cross-app languages`

## Task 2: read-only login email (apps/web family AccountPage)
- apps/web/src/pages/family/AccountPage.tsx writes top-level `email` on the users doc — Firebase Auth's email is NOT updated by this, so login breaks silently out of sync. Make the email display-only with study's rationale comment; remove it from the save payload. If sit's page also lets babysitters/other roles edit email via a shared component, scope ONLY the family page (check; note anything shared in the report).
- TDD: payload-shape test asserting no `email` key on save (mirror study's).
- Commit: `fix(web): family account login email is read-only (Firebase Auth desync)`

## Task 3: getValidGraduationYears TZ flake (packages/sit-core)
- packages/sit-core src/constants config: the function derives the school-year boundary from a Date that's parsed/read in local time (`new Date('2026-09-01')` parses UTC midnight; reading it in a negative-offset TZ yields Aug 31). Fix the FUNCTION or the TEST wherever the defect actually is — read both first: if the production logic itself shifts by TZ (uses local getMonth on a UTC-parsed date), fix the production logic with explicit component-based construction (the study-core dates idiom: never `new Date(str)` for calendar math); if only the test constructs dates wrong, fix the test. State which it was in your report.
- Proof: the previously failing test passes under BOTH `TZ=UTC` and `TZ=America/New_York` and `TZ=Europe/Paris` (run all three).
- Commit: `fix(sit-core): TZ-safe school-year boundary in getValidGraduationYears`

## Task 4: gates + push
- Full gates: `pnpm test:unit` under the three TZs for sit-core (the exemption is RETIRED by this PR — note it); apps/web tests + typecheck + lint baseline; FULL emulator integration suite unchanged (no backend changes).
- Push fix/sit-data-safety. NO PR — controller final-reviews and opens it.
