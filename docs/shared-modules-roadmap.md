# Shared Modules Roadmap

> **Purpose:** strategic sequence for moving duplicated code between `apps/web` (sync-sit) and `apps/study-web` (sync-study) into shared packages, plus the architectural work that makes a single user portable between the two apps.
>
> **Not a per-task plan.** Each numbered item below is its own detailed implementation plan under `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`. The roadmap names the slugs and the order; the per-plan docs do the actual work.
>
> **Status legend:** `[ ]` = not started · `[~]` = plan written, not executed · `[x]` = merged.

---

## Tier 1 — pure UI refactors (low risk, no schema)

### A. Shared enrollment-flow steps `[~]`
**Plan:** `docs/superpowers/plans/2026-06-10-shared-auth-flow.md`
**Scope:** lift `StepEmail`, `StepVerify`, `StepPassword` from both apps' enrollment trees into `@ejm/shared-ui/enrollment/*`. Orchestrators in each app wrap the callable invocations and pass handlers as props.
**Why now:** these three are line-for-line duplicates after PR #57's hand-aligned fixes; first PR that pays back the duplication tax.
**Files moved:** 3 components into `packages/shared-ui/src/enrollment/`; 6 deleted from `apps/*/src/pages/enrollment/*`. Orchestrators updated.
**Out of scope:** profile + preferences steps (domain-specific to each app), the portable user entity, cross-app skip logic.
**Estimate:** 6 commits / 1 PR.
**Depends on:** PR #57 (the `--color-error-*` token split landed there).

---

### B. Shared static / legal pages `[ ]`
**Plan slug (to write):** `2026-XX-XX-shared-static-pages.md`
**Scope:** `PrivacyPage`, `TermsPage`, `AboutPage`, `ReportProblemPage` — currently full-content in sync-sit, "Coming soon" stubs in sync-study (added in PR #57 to make the welcome page footer links resolve). Move the page shell into `@ejm/shared-ui`. Move the legal copy into a shared content module (likely `@ejm/shared-core/content/`) since it's plain Markdown / structured text, not React.
**Why now:** quickest win after Plan A; eliminates the placeholder pages PR #57 left and removes another whole class of "the two apps drift."
**Files:** ~4 new shared page components, ~4 content modules (en + fr), 4 deleted from `apps/web/src/pages/public/`, 4 deleted from `apps/study-web/src/pages/public/`. Both routers updated.
**Open design question:** does each app inject a brand-specific intro paragraph (e.g. "Sync/Sit is operated by Tandy SARL...") via prop, or is the legal copy identical across both apps? (Tandy SARL operates both, so probably identical with a brand-name interpolation.)
**Estimate:** 5 commits / 1 PR.
**Depends on:** A (just the order; technically independent).

---

### C. Shared public auth pages `[ ]`
**Plan slug (to write):** `2026-XX-XX-shared-public-auth-pages.md`
**Scope:** `WelcomePage`, `LoginPage`, `SignUpRolePage`, `ForgotPasswordPage`. PR #57 hand-aligned them on the sync-study side but they're still hand-duplicated in two trees — the exact "drift class" the user wants to close.
**Approach:** extract reusable shells. `WelcomeHero` takes `logoSrc`, `title`, `subtitle`, `ctaSignUpHref`, `ctaLoginHref`, optional `languageSelector`. `LoginPage` takes `postLoginRouter(role) => path`. `SignUpRolePage` takes a `roles: { value, labelKey, descKey, icon, href }[]` array.
**Why now:** the LoginPage already routes by role; after we have shared shells, Plan D (portable user entity) can change the role lookup in one place.
**Files:** 4 new components in `@ejm/shared-ui`; 4 deleted in each of the two apps; router entries updated.
**Estimate:** 6 commits / 1 PR.
**Depends on:** A merged (so the shared step imports show the consumption pattern this PR mirrors).

---

## Tier 2 — architectural change (medium risk, touches schema + callables)

### D. Portable user entity `[ ]`
**Plan slug (to write):** `2026-XX-XX-portable-user-entity.md`
**Scope:** replace top-level `role` on `users/{uid}` with `profiles.{sit?,study?}: { role, enrollmentComplete, ... }`. Update `enrollBabysitter` + `enrollFamily` + `enrollTutor` callables to write under `profiles.sit` / `profiles.study`. Cross-app skip: when a sync-sit user logs in to sync-study and has no `profiles.study`, route them into the tutor- or parent-side enrollment WITHOUT re-doing Email/Verify/Password. Migration: one-time script that lifts each existing user's top-level `role` into `profiles.sit.role` (sync-sit is the source of pre-existing data).
**Why now:** unlocks every cross-app experience. Has to come before any Tier 4 work that touches per-app role-driven UI.
**Schema preview:**
```typescript
interface UserBase {
  uid: string;
  ejemEmail: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: FirestoreTimestamp;
  classLevel: string;
  gender?: 'female' | 'male' | 'other' | 'prefer_not_to_say';
  status: 'active' | 'blocked' | 'deleted';
  consentAt: FirestoreTimestamp;
  consentVersion: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  profiles: {
    sit?: { role: 'babysitter' | 'parent'; enrollmentComplete: boolean; /* +app-specific fields */ };
    study?: { role: 'tutor' | 'parent'; enrollmentComplete: boolean; /* +app-specific fields */ };
  };
  // Admin lives outside profiles — one admin role for both apps.
  isAdmin?: boolean;
}
```
**Risk:** existing prod data has top-level `role`. Strategy: ship the new schema + migration in the same PR; runtime fallback for one release reads `role` if `profiles.{app}.role` is absent; remove the fallback in the next PR after the migration has run.
**Files affected (heavy):** `packages/shared-core/src/types/user.ts`; `apps/functions/src/enrollment/{enrollBabysitter,enrollFamily,joinFamily,removeCoParent}.ts`; `apps/study-functions/src/enrollment/enrollTutor.ts`; both `LoginPage`s (from Plan C); `firestore.rules` (per-role gates need updating); plus a one-time migration callable or script.
**Estimate:** 10–12 commits / 1 PR (large but coherent — splitting risks half-migrated state).
**Depends on:** A, B, C merged (the orchestrators that Plan D updates are the ones extracted in Plan A; the LoginPage that gets the new routing lives in Plan C).

---

## Tier 3 — app shells (depends on D for the role model; otherwise standalone)

### E. Shared app shells + menu `[ ]`
**Plan slug (to write):** `2026-XX-XX-shared-app-shells.md`
**Scope:** `AppBar` (the top branded bar with hamburger menu — currently `apps/web/src/components/ui/AppBar.tsx`), `EnrollmentAppBar`, `PushPrompt`, `InstallAppBanner`. Plus the four `*Layout.tsx` files (`AdminLayout`, `BabysitterLayout`, `FamilyLayout`, `PublicLayout`) and `AuthGuard`. Hamburger menu items become role-prop-driven so the same `AppBar` component renders the sync-sit babysitter menu, the sync-study tutor menu, the family side of either app, etc.
**Why now:** closes the explicit Phase 1 deferred carry-forward (status doc §"Phase 1 — three components deferred from extraction"). After this lands, every page in both apps shares its chrome.
**Files:** `AppBar`, `EnrollmentAppBar`, `PushPrompt`, `InstallAppBanner` move into `@ejm/shared-ui`. Layouts move into shared-ui as a `layouts/` subfolder, OR each app keeps its own thin layout that wraps a shared `RoleLayout` taking the menu prop. `AuthGuard` becomes prop-driven (`allowedRoles: ('babysitter' | 'parent' | 'tutor' | 'admin')[]`).
**Open design question:** layouts that pull from `useAuthStore` directly are tightly coupled to each app's store instance. Decision: keep app-specific layouts as thin wrappers (`apps/*/src/layouts/AuthGuard.tsx` reads its own authStore, calls shared `<RoleLayout role={...} menu={...} />`).
**Estimate:** 8 commits / 1 PR.
**Depends on:** D merged (menu and AuthGuard need the new `profiles.{app}.role` shape).

---

## Tier 4 — domain features (independent, each its own plan)

### F. Shared notification settings + push `[ ]`
**Plan slug (to write):** `2026-XX-XX-shared-notifications.md`
**Scope:** `notifPrefs` shape in `users/{uid}` (already partially defined); settings UI section (currently only in sync-sit's `babysitter/AccountPage` and `family/AccountPage`); FCM token registration; service worker (`firebase-messaging-sw.js`); `PushPrompt` (if not already moved as part of E).
**Why now:** sync-study tutors need to be notifiable about session requests. This component is currently sync-sit only; sync-study has no push setup at all.
**Estimate:** 6 commits / 1 PR.
**Depends on:** D merged (notif events fire on profiles.{app} role; cross-app users may want per-app preferences).

---

### G. Shared calendar wrappers + tutor slot picker `[ ]`
**Plan slug (to write):** `2026-XX-XX-shared-calendar.md`
**Scope:** the calendar primitives (`WeeklyTimeline`, `DayEditor`, `OverrideList`) are already in shared-ui. What's not: `SchedulePage` shell that wraps them (currently only `apps/web/src/pages/babysitter/SchedulePage.tsx`) and the new tutor-side calendar slot picker that the Phase 3 booking flow needs (per `docs/sync-study-project-plan.md` §Agent 5 Task 9 — week-by-week availability with padding-aware start times).
**Why now:** the slot picker is genuinely new code; landing it in shared-ui from day one prevents another drift class. Sync-sit can adopt it later for its own booking flow simplification.
**Estimate:** 6 commits / 1 PR — split into 2 if the slot picker UX needs design iteration.
**Depends on:** none (could ship before D if needed; the calendar doesn't read `role`).

---

### H. Shared `AccountPage` skeleton `[ ]`
**Plan slug (to write):** `2026-XX-XX-shared-account-page.md`
**Scope:** sync-sit `babysitter/AccountPage` and `family/AccountPage` both have name / email / photo / contact / notifPrefs / consent / delete-account sections. Tutor + family-side sync-study will need the same set. Generalize: shared `AccountPageShell` renders the common sections, takes `extraSections?: ReactNode[]` for role-specific extras (babysitter's hourly rate, tutor's session lengths, etc.).
**Estimate:** 5 commits / 1 PR.
**Depends on:** D merged (which `profiles.{app}` config to show).

---

### I. Shared dashboard skeleton `[ ]`
**Plan slug (to write):** `2026-XX-XX-shared-dashboard.md`
**Scope:** every role on both apps has a Dashboard with greeting + pending requests + confirmed/upcoming engagements + footer prompts. Common scaffold lives in `@ejm/shared-ui`; per-role cards (`AppointmentCard`, `SessionCard`, future tutor-request card) plug in as children.
**Estimate:** 6 commits / 1 PR.
**Depends on:** D + H (consumption pattern from H translates here).

---

## Order of execution

Sequential by tier, parallel within a tier where dependencies allow:

```
A  →  B  →  C  →  D  →  E  →  F | G | H | I
```

Where `F | G | H | I` are independent and can interleave with each other.

**This roadmap doc is the contract.** Per-plan files under `docs/superpowers/plans/` are the per-PR detail. When a tier's first plan is drafted, the status above flips from `[ ]` → `[~]`. When merged, `[~]` → `[x]` and the plan filename is filled in.
