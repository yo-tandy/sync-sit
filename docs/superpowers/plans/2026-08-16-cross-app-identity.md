# Cross-App Identity Coherence (issue #144) Implementation Plan

> **For agentic workers:** Work in THIS worktree (`.claude/worktrees/identity-coherence`, branch `feature/cross-app-identity`, based on `feature/study-signup-order` = PR #145). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Switching between sync-sit and sync-study must never re-collect or mutate identity. Root identity (firstName/lastName/dateOfBirth) is SET ONCE — enforced in firestore.rules — and both enrollment wizards skip the identity inputs for a signed-in user who already has them.

**Root cause (verified):** Sit's babysitter `StepProfile` (`apps/web/src/pages/enrollment/babysitter/StepProfile.tsx:79`) client-writes root `firstName/lastName/dateOfBirth` unconditionally from empty inputs — and writes DoB as a "YYYY-MM-DD" STRING where study writes a Timestamp. The wizard's post-create branch (`BabysitterEnrollment.tsx` `handleCreateAccount`, add-profile arm) does `setStep(3)` unconditionally, so a cross-app user with existing identity lands on the identity step and overwrites it. The rules identity freeze (`identityUnlockedOrUnchanged`) only protects `identityLocked` (governed-kid) accounts. The resume effect (~line 47) already routes on `!userDoc?.firstName` — the post-create transition just doesn't.

**Architecture:** Three layers, server-first:
1. **Rules (trust boundary):** root identity becomes set-once for owner writes — absent→set allowed, set→change denied. No legitimate client set→change writer exists (verified: only the buggy StepProfile; parent enrollment writes identity into a fresh doc; `correctChildIdentity` uses the Admin SDK and bypasses rules).
2. **Sit wizard:** post-create routes on existing identity exactly like the resume effect; `StepProfile` writes only ABSENT identity fields (belt-and-braces under the new rule) and always writes the profile-scoped fields (classLevel/gender).
3. **Study wizard:** identity schema fields become optional for the add-profile path; the wizard skips the identity INPUTS when the signed-in user already carries them (shows a read-only summary line instead), still collecting classLevel/gender/contact.

**Constraints (repo law):**
- No emoji. No Co-Authored-By. Lint baselines (study 0; web 1 error/7 warnings). Every string i18n'd in en+fr of the right app (sit has its own locale files under `apps/web/src/i18n/`).
- Rules changes REQUIRE running the rules suite (`pnpm exec vitest run tests/rules/firestore-rules.test.ts` from repo root, emulators running — they already are).
- Grep-verify post-state of every scripted edit; mutation-verify the load-bearing pins.
- Full gates: study-web, web, study-functions, sit functions suite if touched (`pnpm --filter functions test` — verify the filter name), rules suite, lints, `pnpm -r typecheck`.

---

### Task 1: firestore.rules — root identity is set-once

Replace/extend the identity guard on users updates. Keep `identityUnlockedOrUnchanged()` (locked accounts stay fully frozen); ADD:

```
    // Root identity is SET-ONCE for client writes: once firstName/lastName/
    // dateOfBirth hold a value, an owner write may not change them (issue
    // #144 — cross-app enrollment must never mutate identity set by the
    // other app). Absent -> set stays allowed (babysitter stub completes
    // its identity step). Corrections go through admin/callables (Admin SDK
    // bypasses rules).
    function rootIdentitySetOnce() {
      return !(request.resource.data.diff(resource.data).affectedKeys()
                 .hasAny(['firstName', 'lastName', 'dateOfBirth']))
             || (
               (!('firstName' in resource.data) || request.resource.data.get('firstName', null) == resource.data.firstName)
               && (!('lastName' in resource.data) || request.resource.data.get('lastName', null) == resource.data.lastName)
               && (!('dateOfBirth' in resource.data) || request.resource.data.get('dateOfBirth', null) == resource.data.dateOfBirth)
             );
    }
```

Wire `&& rootIdentitySetOnce()` into the users update rule chain next to `identityUnlockedOrUnchanged()`. (Adapt the exact accessor idiom to what the file already uses — read the neighboring helpers first; `get()` with default vs `in` checks must match the file's style and Firestore rules semantics. A field ABSENT on resource but present in request must pass; present-and-equal must pass; present-and-different must fail.)

- [ ] Add helper + wire in. Rules tests (extend `tests/rules/firestore-rules.test.ts`): owner CAN set firstName/lastName/dateOfBirth when absent; owner CANNOT change any of the three once set (three assertFails); unrelated updates still pass; a doc with identity absent + other profile complete can still set identity (the stub-completion path).
- [ ] Run the rules suite. Mutation-verify: comment out the `&& rootIdentitySetOnce()` wiring, the set→change pin must fail, restore.
- [ ] Commit: `fix(rules): root identity is set-once for client writes`

### Task 2: Sit wizard — route past the identity step when identity exists

`apps/web/src/pages/enrollment/BabysitterEnrollment.tsx`, `handleCreateAccount` add-profile arm: after `await refreshUserDoc()`, read the fresh doc (`useAuthStore.getState().userDoc`) and branch exactly like the resume effect: `firstName` present → `setStep(4)`, absent → `setStep(3)`.

`apps/web/src/pages/enrollment/babysitter/StepProfile.tsx`: build the update payload conditionally — include each of firstName/lastName/dateOfBirth ONLY when the current userDoc lacks it; always write `profiles.babysitter.classLevel` and `.gender`. If ALL THREE identity fields already exist, the component should not even render inputs for them (it will normally never mount in that state after the routing fix, but a direct URL/remount must not present dead inputs): render the read-only line `t('enrollment.identityOnFile', { name })` instead. Note the DoB string-vs-Timestamp mismatch: when writing dateOfBirth here (absent case), KEEP the existing string format (changing the stored format is out of scope; study's dobDisplay handles both).

- [ ] Update wizard tests (`apps/web/src/pages/enrollment/__tests__/` — find the existing files): pin the post-create branch (add-profile + existing firstName → lands on preferences step, StepProfile never mounts); pin StepProfile's conditional payload (userDoc with identity → updateDoc called WITHOUT firstName/lastName/dateOfBirth keys).
- [ ] Commit: `fix(web): cross-app enrollment never re-collects existing identity`

### Task 3: Study wizard — skip identity inputs for cross-app enrollees

- `apps/study-functions/src/validation/tutor.ts`: `tutorImmutableProfileSchema` — firstName/lastName/dateOfBirth become `.optional()`. `enrollTutor.ts`: for the NEW-ACCOUNT path, validate all three are present (HttpsError invalid-argument otherwise — new accounts must supply identity). For the add-profile path, prefer the EXISTING doc's values; only use payload values via `fillBaseFields` when the doc lacks them (current absent-only behavior already does this — just stop REQUIRING the fields; when absent from payload AND absent on doc, reject). `dobTimestamp` must handle the payload-absent case (only computed when needed).
- `apps/study-web/src/pages/enrollment/tutor/TutorEnrollment.tsx` + `StepProfile.tsx`: when the signed-in user's doc already has firstName/lastName/dateOfBirth (add-profile mode — check how the wizard detects it), StepProfile renders the read-only identity summary (name + DoB) instead of those inputs, still collects classLevel/gender/contact, and the payload omits the identity fields. The age gate: for cross-app users the server already knows DoB; the CLIENT gate should run against the doc's DoB (a 14-year-old sit babysitter must still be blocked from tutor enrollment IF the age floors differ — check what the tutor age gate requires vs sit's; if identical floors, the existing account already passed it and the gate is moot).
- [ ] Tests: schema (absent identity parses; new-account callable-level presence check if a callable test exists), wizard pins (add-profile with identity → summary shown, no name inputs, payload lacks identity keys; fresh signup unchanged).
- [ ] Commit: `feat(study-web): cross-app enrollment shows identity on file instead of re-asking`

### Task 4: i18n + copy

- New keys both apps as needed: `enrollment.identityOnFile` (e.g. "Enrolling as {{name}} — your identity is already on file from your other Sync profile." / FR real translation). Sit locales live in `apps/web/src/i18n/`, study in `apps/study-web/src/i18n/` — add to BOTH langs of whichever app uses the key.
- [ ] Grep every new key in both locale files of its app.

### Task 5: Gates + sweeps

- [ ] All suites: study-web, web, study-functions, sit functions (if touched), rules. Lints at baselines. `pnpm -r typecheck` clean.
- [ ] Greps: no remaining unconditional root-identity updateDoc in either wizard (`grep -rn "firstName," apps/*/src/pages/enrollment` — every hit must be inside an absence-guard or a fresh-account path); new i18n keys in both locales.
- [ ] Do NOT push, do NOT open a PR, no GitHub comments. Report back: per-task status, exact gate outputs, deviations with reasons.

## Notes
- Branch base is PR #145's branch (study wizard was just rebuilt there); the PR for this work opens AFTER #145 merges, rebased onto main.
- The "login without special user input" half of the issue is already handled by the #111 handoff (auth carries over); this plan closes the enrollment half.
- Do NOT try to migrate the DoB string/Timestamp divergence in stored docs — out of scope; display code handles both.
