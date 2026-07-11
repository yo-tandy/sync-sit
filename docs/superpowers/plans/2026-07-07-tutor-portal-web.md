# Tutor Portal Web (PR 2 of tutor-portal-foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tutors get a real portal in apps/study-web: `/tutor` routes (fixing the login 404), a verification-state-aware dashboard, ID-upload verification page, and subjects/schedule/account editing — wired to the backend that merged in #77.

**Architecture:** Copy-adapt sync-sit's babysitter portal chrome (AuthGuard/Layout/AppBar are per-app by convention); reuse shared-ui leaf components (`WeeklyTimeline`/`DayEditor`/`OverrideList`, TopNav, forms); taxonomy from `@ejm/study-core`; verification via the #77 callables (`submitVerification` type `tutor_identity`, `getVerificationStatus` role `tutor`).

**THE STATE CONTRACT (from PR #77 — key everything on this):**

| identityStatus | enrollmentComplete | Dashboard treatment |
|---|---|---|
| not_submitted | false | "Upload your ID" CTA → /tutor/verification |
| pending | false | "Under review" (amber) |
| approved | true | verified; activate-`searchable` toggle (gated: subjects non-empty AND schedule has slots) |
| rejected | false | rejection reason (red) + resubmit CTA |
| pending | true | "New document under review" — tutor stays live |

Key the banner on `identityStatus`; key liveness/search on `enrollmentComplete`. They are independent — do NOT derive one from the other. `profiles.tutor.verification` may be ABSENT on pre-#77 tutors → treat as `not_submitted`.

**Reference files (READ, then adapt — do not invent):**
- Guard/layout/chrome: `apps/web/src/layouts/{AuthGuard,BabysitterLayout}.tsx`, `apps/web/src/components/ui/AppBar.tsx`, `apps/web/src/components/ScrollToTop.tsx` (verify the path).
- Pages: `apps/web/src/pages/babysitter/{DashboardPage,AccountPage,SchedulePage,BabysittingOptionsPage}.tsx`; family verification upload: `apps/web/src/pages/family/VerificationPage.tsx` (storage upload at lines ~72-80) + `apps/web/src/stores/verificationStore.ts`.
- Hooks: `apps/web/src/hooks/{useSchedule,useHolidays}.ts`.
- study-web conventions: `router.tsx`, `layouts/AuthGuard.tsx` (stub to replace), `stores/authStore.ts`, `config/firebase.ts`, test harness `src/__tests__/test-utils.tsx` + the authStore-mock pattern in `pages/enrollment/tutor/__tests__/TutorEnrollment.test.tsx`, i18n `src/i18n/{en,fr}.ts` (parity test enforces en/fr sync).

**Standing recipes (pre-authorized):** builds/emulators/vitest identical to prior plans (see docs/superpowers/plans/2026-07-07-tutor-portal-backend.md header). Unit tests: `cd apps/study-web && ../../node_modules/.bin/vitest run <path>` or `pnpm --filter study-web test`. Lint baselines: 1 pre-existing error per app (router.tsx react-refresh) — add none.

**Invariants:** apps/web untouched by this PR. All Firestore writes from the portal are OWNER-permitted fields only (`profiles.tutor.{subjects,contactEmail,contactPhone,whatsapp,aboutMe,searchable,...}`, `notifPrefs`, schedules) — never `enrollmentComplete`/`verification`/`ejemEmail` (rules will reject; UI must not try). Every user-visible string via i18n keys added EN+FR.

---

## Task 1: Portal skeleton — firebase storage, AuthGuard, TutorLayout, AppBar, routes

**Files:**
- Modify: `apps/study-web/src/config/firebase.ts` (add `getStorage` export + `connectStorageEmulator` in the existing DEV block — mirror how auth/firestore/functions connect)
- Modify: `apps/study-web/src/layouts/AuthGuard.tsx` (replace the passthrough stub)
- Create: `apps/study-web/src/layouts/TutorLayout.tsx`, `apps/study-web/src/components/ScrollToTop.tsx` (copy), `apps/study-web/src/components/ui/AppBar.tsx` (copy-adapt)
- Modify: `apps/study-web/src/router.tsx`
- Test: `apps/study-web/src/layouts/__tests__/AuthGuard.test.tsx` (new)

- [ ] **Step 1 (red):** AuthGuard tests (mirror apps/web's AuthGuard test from the cross-app PR + study harness): signed-out → redirected to /login; authLoading → renders null; tutor (ANY verification state incl. enrollmentComplete false) → renders children — CRITICAL deliberate divergence from the babysitter guard: unapproved tutors must reach the portal; parent-only user → redirected to /signup; admin → /admin? (check what study LoginPage does for admin — route consistently; if no admin portal exists in study-web, parent-only-style /signup fallback for any non-tutor is fine — decide, document in the guard comment). Red run.
- [ ] **Step 2 (green):** Implement AuthGuard (getStudyRole from @ejm/study-core; structure mirrors apps/web's but WITHOUT the incomplete-enrollment ejection); TutorLayout = AuthGuard(role tutor) + AppBar + ScrollToTop + Outlet; AppBar copy-adapt with tutor menu (Dashboard/Account/Subjects/Schedule/Verification + the shared about/privacy/terms/logout block — check what apps/web AppBar includes and what study-web has routes for; only link routes that exist); router: TutorLayout block with `/tutor`, `/tutor/account`, `/tutor/subjects`, `/tutor/schedule`, `/tutor/verification` (pages stubbed as minimal placeholders IN THIS TASK — real pages come in Tasks 2-5; each stub renders its i18n title so routes are testable).
- [ ] **Step 3:** Green run (new tests + full study-web suite + typecheck + lint baseline). Commit: `feat(study-web): tutor portal skeleton — guard, layout, routes`

## Task 2: verificationStore + VerificationPage

**Files:**
- Create: `apps/study-web/src/stores/verificationStore.ts`, `apps/study-web/src/pages/tutor/VerificationPage.tsx` (replacing the Task 1 stub)
- Test: `apps/study-web/src/pages/tutor/__tests__/VerificationPage.test.tsx`

- [ ] Store: zustand, ~60 lines, modeled on apps/web's verificationStore but tutor-only: `fetchStatus()` → `getVerificationStatus({role:'tutor'})`; `submit(file)` → upload via Firebase Storage SDK to `verification-documents/{uid}/{Date.now()}-{fileName}` then `submitVerification({type:'tutor_identity', fileUrl, fileName})`; state: status/documents/loading/error.
- [ ] Page: identity-doc subset of the family VerificationPage — current status display (incl. rejectionReason from the latest document when rejected), file input (10MB limit, image/pdf — copy the family page's validation), upload button with progress/disabled state, success → refetch status. Strings via new i18n keys.
- [ ] Tests (TDD): mock the store module; assert per-state rendering (not_submitted CTA, pending, rejected + reason, approved) and that submit is called with the chosen file. Red → green → full suite → commit: `feat(study-web): tutor verification page and store`

## Task 3: DashboardPage (the state-contract consumer)

**Files:** Create `apps/study-web/src/pages/tutor/DashboardPage.tsx` (replace stub); test `.../__tests__/DashboardPage.test.tsx`

- [ ] Banner per the STATE CONTRACT table (all five rows — including `pending/true` "new document under review, you're still live"). Read `getTutorProfile(userDoc)` from authStore; treat absent `verification` as not_submitted.
- [ ] Activate toggle (approved state only): mirrors babysitter DashboardPage's searchable toggle (`updateDoc` on `'profiles.tutor.searchable'`) gated on `subjects.length > 0` AND schedule has ≥1 true slot (fetch via the useSchedule hook copied in Task 5 — OR read the schedules doc directly here; pick whichever the babysitter dashboard does and mirror it). Disabled state with explanatory text when gates unmet.
- [ ] Upcoming-sessions EMPTY-STATE card only (i18n: "No sessions yet — session booking is coming soon"). Entry cards to Subjects/Schedule/Account/Verification.
- [ ] Tests (TDD): one render assertion per state-contract row (5 cases) driving a mocked authStore userDoc; toggle gating cases (no subjects → disabled; subjects+slots → enabled, updateDoc payload asserted with mocked firestore). Red → green → suite → commit: `feat(study-web): tutor dashboard with verification-state banners and activation`

## Task 4: SubjectsPage

**Files:** Create `apps/study-web/src/pages/tutor/SubjectsPage.tsx`; test `.../__tests__/SubjectsPage.test.tsx`

- [ ] Editor for `SubjectOffering[]`: rows of {subject Select from SUBJECTS, levels multi-chip from CLASS_LEVELS, rate number input (€/h, min 0)}; add/remove rows; client validation (no duplicate subject, ≥1 level, rate > 0); save via `updateDoc(users/{uid}, {'profiles.tutor.subjects': offerings})` + `refreshUserDoc()`; save-state feedback per the BabysittingOptionsPage pattern (read it for the save idiom).
- [ ] Tests (TDD): add/remove row; validation blocks save; save payload asserted (mocked firestore updateDoc). Red → green → suite → commit: `feat(study-web): tutor subjects and rates editor`

## Task 5: AccountPage + SchedulePage + hooks

**Files:** Create `apps/study-web/src/pages/tutor/{AccountPage,SchedulePage}.tsx`, `apps/study-web/src/hooks/{useSchedule,useHolidays}.ts` (copied from apps/web — adjust imports; they depend on firebase config, authStore, @ejm/sit-core types all available here — check and adapt type imports minimally); test `.../__tests__/AccountPage.test.tsx`

- [ ] AccountPage: mirror babysitter AccountPage MINUS photo and push-notification plumbing (email prefs only): read-only identity block (name, DOB, ejemEmail, classLevel), editable contact (contactEmail/contactPhone/whatsapp → nested updateDoc), notifPrefs (top-level, email toggles only), password reset (same flow as the sit page), LanguageSelector. Note in a comment why push is absent (no FCM wiring in study-web yet).
- [ ] SchedulePage: copy-adapt babysitter SchedulePage with `backTo="/tutor"`; shared-ui schedule components; the copied hooks against `schedules/{uid}` (exists for every tutor since enrollment). Known accepted risk (comment it): one grid shared across sit+study for dual-profile users.
- [ ] Tests (TDD): AccountPage contact-save payload + read-only fields present. SchedulePage: smoke render with mocked hooks (the schedule components have e2e coverage in sit; don't re-test them).
- [ ] Commit: `feat(study-web): tutor account and schedule pages`

## Task 6: i18n sweep + gates + FE smoke + PR

- [ ] Verify every new key exists EN+FR (the parity test enforces; grep for raw strings in new pages as a double-check). Full gates: `pnpm typecheck`, `pnpm test:unit`, full emulator integration+rules suite (unchanged backend — must stay 296/296), lint baselines.
- [ ] **FE smoke (controller runs this, not a subagent):** emulators + seeded tutor + `VITE_FIREBASE_PROJECT_ID=demo-test pnpm --filter study-web dev`; browser: log in as tutor → dashboard shows "upload your ID" → verification page → upload a file → status pending → admin approves via callable (direct emulator call) → dashboard shows approved + toggle; save subjects; save a schedule slot; flip searchable on.
- [ ] Final whole-branch review (state-contract fidelity, no writes to protected fields, apps/web untouched, i18n completeness).
- [ ] Push + `gh pr create` (body: state-contract table, screenshots optional, accepted limits: no sessions yet, shared schedule grid, email-only notifications).

## Self-review checklist (before Task 6's PR)
1. No `updateDoc` anywhere in study-web touches `enrollmentComplete`, `verification`, or `ejemEmail`.
2. All five state-contract rows have a distinct, tested dashboard rendering.
3. Absent `verification` field (pre-#77 tutors) renders as not_submitted everywhere.
4. AuthGuard lets unapproved tutors in; signed-out and non-tutor users are routed away.
5. Every new page reachable from the AppBar; every AppBar link resolves to a real route.
