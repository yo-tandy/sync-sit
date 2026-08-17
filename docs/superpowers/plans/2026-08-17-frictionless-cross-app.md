# Frictionless Cross-App Switching (issue #144, owner clarification) Implementation Plan

> **For agentic workers:** Work in THIS worktree (`.claude/worktrees/identity-coherence`, branch `feature/cross-app-identity` = PR #146, stacked on #145). Steps use checkbox syntax.

**Owner requirement (PR #146 comment, verbatim intent):** switching apps must ask for NOTHING that is not unique to the target app. No "do you want to enroll?" question (it's the only option), no EJM email + verification code (verified at first enrollment), no password (same credentials everywhere). First visit → welcome screen stating the user's role in the target app and that the same login works → then ONLY app-specific collection (sit babysitter: weekly availability; study tutor: subjects/rate). Already registered → straight to dashboard. Same for parents.

**Architecture:**

1. **Backend — `crossApp` mode on both enroll callables.** The verified EJM identity already lives on the caller's doc (`profiles.tutor.ejemEmail` / `profiles.babysitter.ejemEmail`); a signed-in cross-app caller re-proving mailbox ownership is redundant by design. New payload shape (add-profile path only): `{ crossApp: true, consentVersion }` (+ `subjects` for enrollTutor). Server derives `ejemEmail` from the caller's OTHER provider profile (reject `failed-precondition` if none), and copies profile-scoped `classLevel`, `gender`, `contactEmail`, `contactPhone`, `whatsapp` from it (fields that exist on both profile types — copy only what's present). Everything else (preflights, role-exclusivity, ensureScheduleDoc, audit, age gate against the stored DoB, prefs defaults for tutor) is IDENTICAL to the existing add-profile path — reuse it, do not fork the logic. The classic code-verified path stays untouched for standalone signups.
2. **Sit client.** `SignUpRolePage`/`postLoginRouter`: an authed user with a tutor profile and no sit role no longer lands on the role-question — route to new `/welcome-sit` (`CrossAppWelcomePage`): greeting by first name, "as an EJM student you can babysit — your Sync/Study login works here", a consent line ("By continuing you accept ..." with the current consentVersion), single Continue button. Continue → `enrollBabysitter({ crossApp: true, consentVersion })` → `refreshUserDoc` → navigate to `/enroll/babysitter` where the resume effect (classLevel now copied server-side → present) sends them to the availability step (StepPreferences, contact prefilled from the copied fields). On `profile-exists` → dashboard.
3. **Study client.** Mirror: authed sit babysitter without a tutor profile hitting study (the post-handoff route for foreign-profile users — find where study routes them today; likely the enrollment entry) → `/welcome-study`: greeting + "as an EJM student you can tutor", consent line, Continue → **StepSubjects only** (tutor-specific, server floor requires ≥1) → `enrollTutor({ crossApp: true, subjects, consentVersion })` → success page (already signed in). No email/verify/password/profile steps.
4. **Parents.** `profiles.parent` is SHARED between the apps, so a parent switching is already "registered" — both apps route them straight to their family dashboard. Add the first-visit welcome as a ONE-TIME dismissible interstitial card on each family dashboard, keyed in localStorage (`sync-welcome-seen-<app>`), shown only when the parent's doc predates the current app (heuristic: always show once per browser; no doc writes). Copy: "Welcome to Sync/Sit — your Sync/Study family account works here as-is."
5. **Existing #146 identity-on-file machinery stays** — it still guards the manual add-profile paths (a user navigating to /enroll/* directly while authed). The switch flow simply no longer routes through them.

**Constraints (repo law):** no emoji; no Co-Authored-By; i18n en+fr in the owning app's locale files; lints at baselines (study 0, web 1/7); rules suite after any rules change (none expected); integration suite (`emulators:exec`, functions rebuilt) MUST cover the new crossApp paths; grep-verify scripted edits; mutation-verify load-bearing pins. Do NOT push or open/modify PRs — report back.

---

### Task 1: Backend crossApp mode

- `apps/functions/src/enrollment/enrollBabysitter.ts`: in the add-profile branch, accept `crossApp === true` → skip code verification entirely; `ejemEmail` := caller's `profiles.tutor.ejemEmail` (reject if absent: `failed-precondition`, 'No verified EJM identity on this account'); profileData gains copied `classLevel`/`gender` (+ contact fields) from the tutor profile when present. Keep: assertCanAddProfile preflight, ensureScheduleDoc, audit (`crossApp: true` in details), consent requirement.
- `apps/study-functions/src/enrollment/enrollTutor.ts`: same shape — derive from `profiles.babysitter.ejemEmail`; copy classLevel/gender/contact into the tutor profile fields the schema knows; `subjects` REQUIRED from payload; prefs defaults + stored-DoB age gate + NaN guard all still apply. The identity presence check passes via the doc (crossApp callers always have identity).
- Zod/validation: crossApp payloads must not be forced through `verificationCode`/`ejemEmail` requirements — branch BEFORE those checks; validate `subjects` through the existing sub-schema for enrollTutor.
- [ ] Integration pins (extend `tests/integration/enrollment/cross-app-enroll-{babysitter,tutor}.test.ts`): crossApp succeeds with NO code doc seeded and no ejemEmail in payload; derived ejemEmail lands on the new profile; classLevel/gender/contact copied; a caller with NO provider profile is rejected; role-exclusive still enforced (parent + crossApp rejected); the code-verified path still works unchanged.
- [ ] Commit server work first.

### Task 2: Sit welcome + routing

- New `apps/web/src/pages/public/CrossAppWelcomePage.tsx` + route `/welcome-sit` (public layout, requires auth — redirect to /login if signed out).
- `postLoginRouter.ts` (and the `/signup` redirect in `AuthGuard`): foreign-provider-profile users (tutor, no sit role) → `/welcome-sit` instead of `/signup`. Users with NO profiles at all keep `/signup`.
- Continue handler: `enrollBabysitter({ crossApp: true, consentVersion })` → refresh → `/enroll/babysitter` (resume lands on availability since classLevel was copied). `profile-exists` error → `/babysitter`.
- [ ] Pins: routing (tutor-only doc → welcome; no-profile doc → signup), welcome Continue calls the callable without code/email and navigates; SignUpRolePage no longer reachable for tutor-only users.

### Task 3: Study welcome + subjects-only flow

- Find how study receives a foreign-profile (sit babysitter, no tutor) authed user today (grep the study router/AuthGuard for its signup/foreign redirect) and route to `/welcome-study` instead.
- New `CrossAppWelcomePage` (study): greeting, role statement, consent line, Continue → renders `StepSubjects` (reused component) → on submit `enrollTutor({ crossApp: true, subjects, consentVersion })` → `/enroll/tutor/success` (user is already signed in; keep the success-state firstName from the doc).
- [ ] Pins: routing, subjects-only flow submits the crossApp payload (no email/code/password/identity keys — pin key ABSENCE), success nav.

### Task 4: Parent one-time welcome

- Both family dashboards: a dismissible one-time card (localStorage key `sync-welcome-seen-sit` / `-study`), copy per plan §4. Show only for parents (role check) — do not show to users who signed up natively in that app? If native-vs-cross detection is not cheap, showing every parent the card once per browser is ACCEPTABLE (state that in the report).
- [ ] Pins: renders once, dismiss persists (localStorage mocked), not rendered again.

### Task 5: i18n + gates

- All new strings en+fr in the owning app. Consent line reuses each app's existing consent copy/version constants (grep how StepPassword renders consent).
- [ ] Full gates: study-web, web, study-functions, sit functions suite if it exists, rules (no change expected — run anyway), INTEGRATION suite via emulators:exec with rebuilt functions, lints, typecheck. Report exact outputs + deviations. Do NOT push.

## Notes
- The removed mailbox re-proof is the owner's explicit call; the audit trail records `crossApp: true` so the provenance of the second profile is inspectable.
- Keep PR #146's existing commits intact — this lands as new commits on top.
