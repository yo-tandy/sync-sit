# Cross-App Enrollment UI (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the frontend to PR #75's backend add-profile contract: enrollment wizards work for logged-in users (no password collection, authed callable calls), `account-exists`/`profile-exists` error details drive login CTAs, and post-login routing stops dead-ending users whose profiles are all foreign to the app.

**Architecture:** A shared `enrollmentErrorReason(err)` helper reads the Firebase client SDK's `FunctionsError.details`. `StepPassword` gains a `collectPassword` prop (consent-only mode). Each wizard reads its app's authStore (`firebaseUser`, `userDoc`, `loading`, `refreshUserDoc` — all already exist in both stores) to enter add-profile mode. Routing fallbacks route to `/signup`, where `SignUpRolePage` shows a cross-app banner for logged-in foreign-profile users.

**Tech Stack:** React 19 + TS, react-router v7, zustand authStores, react-i18next (keys resolve from each app's resources), vitest + jsdom + @testing-library (study-web harness: `renderWithProviders` in apps/study-web/src/__tests__/test-utils.tsx).

**Standing recipes (use these exact shapes — they're pre-authorized):**
- Builds: `pnpm --filter @ejm/shared-core build && pnpm --filter @ejm/sit-core build && pnpm --filter @ejm/study-core build && pnpm --filter @ejm/shared-functions build && pnpm --filter functions build && pnpm --filter study-functions build`
- Emulators: kill stale `lsof -ti :8080 -ti :9099 -ti :5001 -ti :4000 -ti :4001 -ti :4400 -ti :4500 | xargs kill 2>/dev/null`; start `(firebase emulators:start --project demo-test > /tmp/emu-crossapp.log 2>&1 &)`; poll the log for "All emulators ready"; run tests `cd tests && ../node_modules/.bin/vitest run <file>`; kill when done.
- Unit tests: `pnpm --filter study-web test`, `pnpm --filter web test`, or `cd apps/study-web && ../../node_modules/.bin/vitest run <file>`.
- NOTE: shared-ui is consumed from source by both apps (workspace `import` condition) — no shared-ui build step needed for app tests; `pnpm --filter @ejm/shared-ui typecheck` if a typecheck script exists, else rely on app typechecks.

**Behavioral invariants (do not violate):**
- Unauthenticated wizard flows must be pixel/behavior-identical except for the new error CTAs.
- EJM-email verification (steps 0–1 of tutor/babysitter wizards) always runs, add-profile mode included.
- Consent checkbox is still required in add-profile mode (collectPassword=false keeps the checkbox).

---

## Task 1: shared-ui — `enrollmentErrorReason`, `StepPassword.collectPassword`, `SignUpRolePage.banner`

**Files:**
- Create: `packages/shared-ui/src/utils/callableErrors.ts`
- Modify: `packages/shared-ui/src/enrollment/StepPassword.tsx`
- Modify: `packages/shared-ui/src/pages/SignUpRolePage.tsx`
- Modify: `packages/shared-ui/src/index.ts` (or however the package exports — check existing export surface and mirror it)
- Test: `apps/study-web/src/__tests__/shared-ui/StepPassword.test.tsx` (new), `apps/study-web/src/__tests__/shared-ui/callableErrors.test.ts` (new)

- [ ] **Step 1: Write failing tests**

`callableErrors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { enrollmentErrorReason } from '@ejm/shared-ui';

describe('enrollmentErrorReason', () => {
  it('extracts account-exists', () => {
    expect(enrollmentErrorReason({ code: 'functions/already-exists', details: { reason: 'account-exists' } }))
      .toBe('account-exists');
  });
  it('extracts profile-exists', () => {
    expect(enrollmentErrorReason({ details: { reason: 'profile-exists', profile: 'tutor' } }))
      .toBe('profile-exists');
  });
  it('returns null for plain errors and non-errors', () => {
    expect(enrollmentErrorReason(new Error('boom'))).toBeNull();
    expect(enrollmentErrorReason(null)).toBeNull();
    expect(enrollmentErrorReason({ details: { reason: 'other' } })).toBeNull();
  });
});
```

`StepPassword.test.tsx` (use `renderWithProviders` from `../test-utils.js` — check the exact import path/extension used by sibling tests):
```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { StepPassword } from '@ejm/shared-ui';
import { renderWithProviders } from '../test-utils';

describe('StepPassword collectPassword=false', () => {
  it('hides password inputs, submits with consent only', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <StepPassword onSubmit={onSubmit} consentVersion="1.0" loading={false} error={null} collectPassword={false} />,
    );
    // No password inputs rendered
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    // Submit disabled until consent checked
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('', '1.0'));
  });

  it('default mode still renders password inputs', () => {
    renderWithProviders(
      <StepPassword onSubmit={vi.fn()} consentVersion="1.0" loading={false} error={null} />,
    );
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
  });
});
```

Run: `cd apps/study-web && ../../node_modules/.bin/vitest run src/__tests__/shared-ui/` → expect FAIL (helper doesn't exist; prop not supported).

- [ ] **Step 2: Implement `callableErrors.ts`**

```ts
/**
 * Extracts the machine-readable enrollment error reason set by the backend
 * (HttpsError details: { reason: 'account-exists' | 'profile-exists', ... }).
 * Works on the Firebase client SDK's FunctionsError, which exposes the
 * HttpsError third argument as `details`. Returns null for anything else.
 */
export type EnrollmentErrorReason = 'account-exists' | 'profile-exists';

export function enrollmentErrorReason(err: unknown): EnrollmentErrorReason | null {
  const details = (err as { details?: { reason?: unknown } } | null)?.details;
  const reason = details?.reason;
  return reason === 'account-exists' || reason === 'profile-exists' ? reason : null;
}
```

Export from the package index alongside existing exports.

- [ ] **Step 3: Implement `StepPassword.collectPassword`**

Add to the props interface (with JSDoc):
```ts
  /**
   * When false (add-profile mode for an already-authenticated user), the
   * password inputs and requirements are hidden and submitting only records
   * consent — onSubmit is called with an empty password.
   */
  collectPassword?: boolean;
```
Destructure with default `collectPassword = true`. Changes:
- `canSubmit`: `const canSubmit = (collectPassword ? allReqsMet && passwordsMatch : true) && consent && !loading;`
- `onSubmit(collectPassword ? password : '', consentVersion)` in handleSubmit.
- Wrap the two `<Input>` blocks and the requirements `<div>` in `{collectPassword && (…)}`.
- Heading/subtitle: when `!collectPassword`, use `t('enrollment.confirmConsentTitle')` for the h2 and hide the `auth.passwordRequirements` subtitle.
- Button label: `{loading ? t(collectPassword ? 'auth.creatingAccount' : 'auth.saving') : t(collectPassword ? 'auth.createAccount' : 'auth.agreeAndContinue')}`.

- [ ] **Step 4: Implement `SignUpRolePage.banner`**

Add optional `banner?: string` prop; when set, render above the role cards (after the description paragraph):
```tsx
{banner && (
  <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{banner}</p>
)}
```
(Match the file's existing class idioms — inspect and adapt if it uses different palette utilities.)

- [ ] **Step 5: Add i18n keys** (all four files: `apps/web/src/i18n/{en,fr}.ts`, `apps/study-web/src/i18n/{en,fr}.ts`)

Under `auth`: `agreeAndContinue` ("Agree & continue" / "Accepter et continuer"), `saving` ("Saving..." / "Enregistrement...").
Under `enrollment`: `confirmConsentTitle` ("Almost there" / "Presque terminé"), `accountExistsCta` ("An account with this email already exists. Log in to add this role." / "Un compte existe déjà avec cet e-mail. Connectez-vous pour ajouter ce rôle."), `alreadyEnrolled` ("This account already has this role." / "Ce compte possède déjà ce rôle."), `alreadyInFamily` ("You already belong to a family." / "Vous appartenez déjà à une famille.").
Under `signup`: `crossAppBanner` — app-specific copy: sit: "You're signed in — pick a role to add to your existing account." / study equivalent; FR translations for both.

- [ ] **Step 6: Run tests + typecheck** — study-web test command above (expect PASS) and `pnpm --filter web --filter study-web typecheck` (or `pnpm typecheck` if package scripts absent).

- [ ] **Step 7: Commit** — `feat(shared-ui): consent-only StepPassword mode, signup banner, enrollment error helper`

---

## Task 2: verifyParentEmail details contract

**Files:**
- Modify: `packages/shared-functions/src/auth/verifyParentEmail.ts` (~line 32)
- Modify: `tests/integration/enrollment/verify-ejm-email.test.ts` — add a sibling describe or new case

- [ ] **Step 1: Add failing integration case** (in the existing verify-ejm-email test file, a new `describe('verifyParentEmail', ...)` block): unauthenticated `callFunction('verifyParentEmail', { email: seed.parent1.email })` → rejects `{ code: 'ALREADY_EXISTS', details: { reason: 'account-exists' } }`.
- [ ] **Step 2: Red run** (emulator recipe; run just this file).
- [ ] **Step 3: Implement** — add third arg `{ reason: 'account-exists' }` to the HttpsError.
- [ ] **Step 4: Rebuild shared-functions + functions + study-functions, restart emulators, green run.**
- [ ] **Step 5: Commit** — `feat(auth): verifyParentEmail carries account-exists details`

---

## Task 3: TutorEnrollment add-profile mode

**Files:**
- Modify: `apps/study-web/src/pages/enrollment/tutor/TutorEnrollment.tsx`
- Modify: `apps/study-web/src/pages/enrollment/tutor/__tests__/TutorEnrollment.test.tsx`

Behavior spec:
- Read authStore: `const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();` (mirror BabysitterEnrollment.tsx:19's selector style if different). `const isAddProfile = !!firebaseUser;`
- Mount effect: `if (!authLoading && firebaseUser && getTutorProfile(userDoc))` → `navigate('/', { replace: true })` (import `getTutorProfile` from `@ejm/study-core`).
- Step 2: `<StepPassword collectPassword={!isAddProfile} …/>`; the existing onSubmit stores password locally — in add-profile mode it receives `''`, which is fine (never sent).
- Final call: build the payload and omit `password` when `isAddProfile` (`...(isAddProfile ? {} : { password })`). Success: `if (isAddProfile) await refreshUserDoc();` then existing navigate to success page.
- Error handling at step 0 (verifyEjmEmail catch) and final (enrollTutor catch): use `enrollmentErrorReason(err)`; `'account-exists'` → set an error element rendering `t('enrollment.accountExistsCta')` with a `<Link to="/login">` (add a dedicated error-state that renders the CTA — plain string error stays for other failures); `'profile-exists'` → `t('enrollment.alreadyEnrolled')`.

Tests (extend the existing file's mocking pattern — StepPassword is mocked there; update the mock to expose the `collectPassword` prop it received, e.g. render `data-collect={String(props.collectPassword)}`):
1. Authed (mock authStore: firebaseUser set, userDoc without tutor profile): StepPassword receives `collectPassword=false`, and the enrollTutor payload has NO `password` key.
2. Authed with tutor profile in userDoc: navigates to `/` (mock useNavigate, assert call).
3. Unauthed (default): `collectPassword=true` and payload includes password (existing behavior — likely already covered; extend assertions).
TDD: add tests, red run (`cd apps/study-web && ../../node_modules/.bin/vitest run src/pages/enrollment/tutor/__tests__/TutorEnrollment.test.tsx`), implement, green run.

- [ ] Steps: write failing tests → red → implement → green → commit `feat(study-web): tutor enrollment add-profile mode for signed-in users`

---

## Task 4: BabysitterEnrollment + ParentEnrollment add-profile modes

**Files:**
- Modify: `apps/web/src/pages/enrollment/BabysitterEnrollment.tsx`, `apps/web/src/pages/enrollment/ParentEnrollment.tsx`

Behavior spec (BabysitterEnrollment):
- Extend the resume effect (lines 28–43): new branch — `if (firebaseUser && !babysitter)` → set `isAddProfile` state true and STAY at step 0 (EJM gate runs). Keep existing branches unchanged.
- `handleCreateAccount`: when isAddProfile — call `enrollBabysitter` WITHOUT password, skip `signInWithEmailAndPassword` and the subscribe-wait, `await refreshUserDoc()`, `setStep(3)`.
- Step 2 renders `<StepPassword collectPassword={!isAddProfile} …/>`.
- Error CTAs via `enrollmentErrorReason` on the verifyEjmEmail and enrollBabysitter catches (same pattern as Task 3).

Behavior spec (ParentEnrollment):
- Mount effect (new): `if (!authLoading && firebaseUser)`: `getParentProfile(userDoc)` → `navigate('/family', { replace: true })`; else set isAddProfile true and `setStep(3)` (FamilyInfo directly — steps 0–2 are all credentials).
- `handleComplete`: when isAddProfile — send only the family payload (no email/verificationCode/password), skip sign-in + wait, `await refreshUserDoc()`, navigate `/family`.
- Step 0 verifyParentEmail catch: `account-exists` → `t('enrollment.accountExistsCta')` + login link.

apps/web has no page-test harness for these (no existing tests for enrollment pages); coverage strategy per the approved plan is: shared pieces unit-tested (Task 1), routing tested (Task 6), and the FE smoke (Task 7) exercises the real flows. Keep changes tight; run `pnpm --filter web test` (existing 43 tests must stay green) and `pnpm --filter web typecheck` (if script exists; else app builds via `pnpm --filter web build`).

- [ ] Steps: implement → run web tests + typecheck/build → commit `feat(web): babysitter and parent enrollment add-profile modes`

---

## Task 5: JoinFamilyPage authed confirm flow

**Files:**
- Modify: `apps/web/src/pages/enrollment/JoinFamilyPage.tsx`

Behavior spec:
- Token validation at mount unchanged (validateInviteLink, gives familyName).
- Authed + `getParentProfile(userDoc)` → render `t('enrollment.alreadyInFamily')` message (with a link to `/family`), no join UI.
- Authed without parent profile: skip the 3 credential steps; render a single confirm view — family name + one button (`t('enrollment.joinFamilyConfirm')`, add key EN/FR both apps: "Join the {{familyName}} family" / FR) → `joinFamily({ token })` (token only) → `refreshUserDoc()` → navigate `/family`. Error: `profile-exists` → alreadyInFamily message (race-safe); other errors → existing error display.
- Unauthed flow unchanged + `account-exists` login CTA on the joinFamily catch.
- [ ] Steps: implement → `pnpm --filter web test` + typecheck/build → commit `feat(web): authed join-family confirm flow`

---

## Task 6: Routing hardening + banner wiring + tests

**Files:**
- Modify: `apps/web/src/pages/public/LoginPage.tsx` (fallback `'/'` → `'/signup'`)
- Modify: `apps/web/src/layouts/AuthGuard.tsx` (line ~43 fallback `Navigate to '/'` → `'/signup'`)
- Modify: `apps/study-web/src/pages/public/LoginPage.tsx` (`parent` → `'/signup'`; fallback `'/'` → `'/signup'`; `tutor`/`admin` unchanged)
- Modify: both apps' SignUpRolePage wrappers — read authStore; compute app-local role (`getSitRole`/`getStudyRole`); when `firebaseUser && !role`, pass `banner={t('signup.crossAppBanner')}`
- Test: extend `apps/study-web/src/pages/public/__tests__/LoginPage.test.tsx` (parent → `/signup`, fallback → `/signup`); NEW `apps/web/src/pages/public/__tests__/LoginPage.test.tsx` mirroring the study test's mocking approach (all four role mappings incl. fallback); NEW AuthGuard fallback test if a harness pattern fits cheaply (mock authStore with tutor-only userDoc, assert Navigate target — mirror how study tests mock; if apps/web lacks the pattern, mirror study's test-utils inline).

- [ ] Steps: write failing router tests → red → implement → green (`pnpm --filter web test && pnpm --filter study-web test`) → commit `feat: route foreign-profile logins to signup with cross-app banner`

---

## Task 7: Full gates, FE smoke, final review, PR

- [ ] `pnpm typecheck` and `pnpm test:unit` (all green).
- [ ] Full integration + rules suite via the emulator recipe (`cd tests && ../node_modules/.bin/vitest run`) — all files green (send-reminders now passes in any TZ since #74 merged).
- [ ] **FE smoke** (controller does this, not a subagent): emulators up; seed via integration seed; `pnpm --filter study-web dev`; in the browser: log in as seeded sit parent → `/enroll/tutor` → EJM email+code steps → verify step 2 shows consent-only (no password fields) → finish → success page; then verify in the emulator that `users/{parent1}` has `profiles.tutor` and `profiles.parent` intact.
- [ ] Final whole-branch review subagent (cross-cutting: unauthed flows untouched, i18n keys complete in all four files, no authStore misuse).
- [ ] Push, `gh pr create` (body: summary, error-contract consumption, routing table before/after, accepted scope limits from the approved plan, test evidence incl. smoke).

## Self-review checklist (before Task 7's PR)
1. Every wizard's unauthed flow behavior-identical (diff review) except error CTAs.
2. `collectPassword=false` keeps the consent checkbox mandatory everywhere it's used.
3. No wizard sends `password: ''` to a callable in authed mode (key omitted, not empty).
4. All new i18n keys exist in EN+FR in BOTH apps (grep each key ×4 files).
5. `refreshUserDoc()` is awaited before any post-success navigation in authed modes.
