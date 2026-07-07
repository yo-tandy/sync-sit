# Tutor Portal Backend (PR 1 of tutor-portal-foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tutors get a real approval pipeline: document-based identity verification through the EXISTING family-KYC machinery (`verifications` collection + callables + admin review) via a new `type: 'tutor_identity'`, with the tutor state machine made server-owned (`enrollmentComplete` flipped only by admin approval; owners blocked from touching it by rules).

**Architecture:** No parallel machinery. Each verification callable gains a per-type branch: tutor docs have no `familyId`, are keyed by `uploadedByUserId`, and drive `users/{uid}.profiles.tutor.verification.identityStatus` (+ `enrollmentComplete` on approve) instead of the family recompute. `enrollTutor` initializes the new state and fixes the `searchable:true` inconsistency to `false`. New rules guard `tutorIdentityUnchanged()` mirrors `babysitterIdentityUnchanged()`. Taxonomy constants move to `@ejm/study-core` for the upcoming portal UI.

**Tech Stack:** Firebase Functions v2 callables (deployed via the DEFAULT codebase — family paths must stay behavior-identical), Firestore, vitest integration tests (`tests/integration/`) + rules tests (`tests/rules/`).

**Standing recipes (pre-authorized shapes):**
- Builds: `pnpm --filter @ejm/shared-core build && pnpm --filter @ejm/sit-core build && pnpm --filter @ejm/study-core build && pnpm --filter @ejm/shared-functions build && pnpm --filter functions build && pnpm --filter study-functions build`
- Emulators: kill stale `lsof -ti :8080 -ti :9099 -ti :5001 -ti :4000 -ti :4001 -ti :4400 -ti :4500 | xargs kill 2>/dev/null`; start `(firebase emulators:start --project demo-test > /tmp/emu-tutor.log 2>&1 &)`; poll for "All emulators ready"; tests `cd tests && ../node_modules/.bin/vitest run <path>`; kill when done.
- Rebuild after ANY shared-functions/functions/study-functions change, then RESTART emulators (they don't hot-reload dist).

**Behavioral invariants:**
- Family verification flows byte-identical (existing integration tests are the guard — run them in every green run).
- Babysitter behavior untouched (their client-writable `enrollmentComplete` stays; documented in the PR, not changed).
- Tutor state machine: `verification.identityStatus: not_submitted → pending → approved|rejected` (re-upload → pending); `enrollmentComplete` false→true ONLY via reviewVerification approve; `searchable` defaults false at enrollment.

---

## Task 1: Types + taxonomy constants move

**Files:**
- Modify: `packages/shared-core/src/types/verification.ts`
- Create: `packages/study-core/src/constants/{subjects,classLevels,sessionLengths,locationPrefs}.ts` + `packages/study-core/src/constants/index.ts`
- Modify: `packages/study-core/src/index.ts` (export constants)
- Modify: `apps/study-functions/src/constants/*.ts` (become one-line re-exports from `@ejm/study-core`)

- [ ] **Step 1:** In `verification.ts`: `VerificationType` union gains `'tutor_identity'`; `familyId` becomes optional (`familyId?: string`) with a JSDoc line ("absent on tutor_identity docs — tutor docs are keyed by uploadedByUserId"); add:
```ts
/** Verification state stored on users/{uid}.profiles.tutor.verification */
export interface TutorVerificationStatus {
  identityStatus: VerificationStatus;
}
```
(Check the actual current file first — mirror its naming/exports; `VerificationStatus` should already exist.)
- [ ] **Step 2:** MOVE the four constants files from `apps/study-functions/src/constants/` into `packages/study-core/src/constants/` verbatim (keep comments); add a barrel `index.ts`; export from the package index. Replace each study-functions constants file body with `export * from '@ejm/study-core';`-style re-export of the specific constant (match how study-functions imports resolve — check its tsconfig/module style; the files are imported as `../constants/subjects.js` internally, so keep the same filenames re-exporting from `@ejm/study-core`).
- [ ] **Step 3:** Build: shared-core, study-core, study-functions (recipe). Run `pnpm --filter study-functions test` (its 11 unit tests must stay green) and `pnpm typecheck`.
- [ ] **Step 4:** Commit: `refactor(study-core): host tutor taxonomy constants; tutor verification types`

## Task 2: enrollTutor state init (TDD)

**Files:** Modify `apps/study-functions/src/enrollment/enrollTutor.ts`; modify `tests/integration/enrollment/enroll-tutor.test.ts` and `tests/integration/enrollment/cross-app-enroll-tutor.test.ts`.

- [ ] **Step 1 (red):** Update both test files: assert `profiles.tutor.searchable === false` (currently asserts/implies true — enroll-tutor.test.ts asserts searchable true at ~line 62; cross-app file asserts `tutor.searchable` true — change both) and `profiles.tutor.verification` deep-equals `{ identityStatus: 'not_submitted' }`. Emulator recipe; run both files; expect FAIL on the new assertions.
- [ ] **Step 2 (green):** In the `tutorProfile` literal in enrollTutor.ts: `searchable: false` and add `verification: { identityStatus: 'not_submitted' }`. Rebuild study-functions, restart emulators, both files green.
- [ ] **Step 3:** Commit: `feat(study-functions): tutor enrollment starts unsearchable with verification state`

## Task 3: seed + submitVerification tutor branch (TDD)

**Files:** Modify `packages/shared-functions/src/verification/submitVerification.ts`, `tests/setup/seed.ts`; create `tests/integration/verification/tutor-submit-verification.test.ts` (check whether tests/integration/verification/ exists — if the family submit tests live elsewhere, colocate accordingly).

Current submitVerification (read it, 104 lines): auth check → parent-only guard (lines 29-39) → validate type/fileUrl/fileName → delete existing same-type docs by familyId → create doc {verificationId, familyId, uploadedByUserId, type, status:'pending', fileUrl, fileName, createdAt} → update families/{id}.verification block → audit `verification_submitted` → sendAdminNotification → return {verificationId}.

- [ ] **Step 1:** Add `tutor1` to `tests/setup/seed.ts`: auth user + users doc with `profiles.tutor` (enrollmentComplete:false, ejemEmail, searchable:false, verification:{identityStatus:'not_submitted'}, minimal subjects/session fields matching TutorProfile), plus a `schedules/{uid}` doc (mirror the babysitter seed's shape). Follow the file's existing helper conventions; expose on SeedData.
- [ ] **Step 2 (red):** New test file, cases: (1) seeded tutor + valid `{type:'tutor_identity', fileUrl:'https://firebasestorage.googleapis.com/...v0/b/x/o/verification-documents%2F<uid>%2Fdoc.pdf', fileName:'doc.pdf'}` → returns verificationId; verifications doc exists with `uploadedByUserId===tutor uid`, `type==='tutor_identity'`, `status==='pending'`, NO `familyId` field; `users/{uid}.profiles.tutor.verification.identityStatus === 'pending'`; enrollmentComplete still false. (2) resubmit: second call replaces — exactly ONE tutor_identity doc for that uid afterwards. (3) a parent WITHOUT a tutor profile calling with type 'tutor_identity' → PERMISSION_DENIED. (4) family identity submit by seeded parent still works unchanged (regression canary in this file, or run the existing family submit test file if one exists — find it first; if none exists, add this canary case). Expect FAIL (permission-denied 'Only parents...').
- [ ] **Step 3 (green):** Implement the branch: after the auth check, `const isTutorDoc = data.type === 'tutor_identity';` — for tutor docs: guard `userDoc.data()?.profiles?.tutor` (permission-denied 'Only tutors can submit tutor verification' otherwise); delete prior docs via `where('uploadedByUserId','==',uid).where('type','==','tutor_identity')`; doc payload WITHOUT familyId; instead of the family-verification update: `users/{uid}` update `{'profiles.tutor.verification.identityStatus': 'pending'}`; audit details `{type, role:'tutor'}`; admin email label 'Tutor Identity Document'. Parent path untouched (keep the parent-only guard for the two family types). Rebuild shared-functions + functions + study-functions, restart, green (all cases + existing family verification integration tests if any exist — search tests/ for submitVerification usage).
- [ ] **Step 4:** Commit: `feat(verification): tutor_identity submissions keyed by uploader`

## Task 4: reviewVerification tutor branch (TDD)

**Files:** Modify `packages/shared-functions/src/verification/reviewVerification.ts`; create `tests/integration/verification/tutor-review-verification.test.ts`.

Current reviewVerification (read it, 96 lines): admin gate → update doc status/reviewedBy/reviewedAt/rejectionReason → recompute families/{familyId}.verification from all family docs → audit → return {success, isFullyVerified}.

- [ ] **Step 1 (red):** Test cases (seed admin user for getIdToken — check how existing admin integration tests authenticate; there IS an admin in seedTestData): (1) approve a pending tutor doc → doc status approved; `profiles.tutor.verification.identityStatus==='approved'` AND `profiles.tutor.enrollmentComplete===true`. (2) reject (with reason) → doc rejected + rejectionReason; identityStatus 'rejected'; enrollmentComplete stays false. (3) resubmit-after-reject then approve → pending → approved (exercise the full loop). (4) family review regression canary. Expect FAIL (current code crashes or misbehaves on `familyId === undefined` — the recompute queries `where('familyId','==',undefined)`).
- [ ] **Step 2 (green):** Branch after loading verificationData: `if (verificationData.type === 'tutor_identity') { ... }` — update the doc (same fields as today), then `users/{verificationData.uploadedByUserId}` update: `{'profiles.tutor.verification.identityStatus': decision, ...(decision === 'approved' ? {'profiles.tutor.enrollmentComplete': true} : {})}`, audit (unchanged shape), `return { success: true };` — skipping the family recompute entirely. Family path untouched. Rebuild/restart/green.
- [ ] **Step 3:** Commit: `feat(verification): tutor review drives profiles.tutor state; approve completes enrollment`

## Task 5: getVerificationStatus role param + getVerificationDocument owner case + listPendingVerifications hardening (TDD)

**Files:** Modify the three callables in `packages/shared-functions/src/verification/`; create `tests/integration/verification/tutor-verification-access.test.ts`.

- [ ] **Step 1 (red):** Cases: (1) `getVerificationStatus({role:'tutor'})` as seeded tutor → `{verification:{identityStatus:...}, documents:[...]}` reflecting their state (submit first via callable). (2) default/parent call by seeded parent unchanged (regression). (3) `getVerificationDocument` for a path `verification-documents/{tutorUid}/x.pdf`: tutor owner → signed URL (in the emulator this may fail at the storage layer — if signed-URL minting doesn't work against the storage emulator, assert the AUTHORIZATION outcome: non-owner tutor gets PERMISSION_DENIED, owner gets past authorization — check how existing getVerificationDocument tests handle this, if any exist; adapt pragmatically and note it). (4) other tutor → PERMISSION_DENIED; admin → authorized. (5) `listPendingVerifications` as admin with a pending tutor doc present → returns it without crashing on missing familyId, with a usable display name.
- [ ] **Step 2 (green):**
  - getVerificationStatus: `role?: 'parent'|'tutor'` in input (default 'parent'); tutor branch requires profiles.tutor; returns `{ verification: profiles.tutor.verification ?? {identityStatus:'not_submitted'}, documents }` from `where('uploadedByUserId','==',uid).where('type','==','tutor_identity').orderBy('createdAt','desc')`.
  - getVerificationDocument: add owner authorization case — after parsing `parts[1]`, allow when `parts[1] === request.auth.uid` (before the family-membership check).
  - listPendingVerifications: make family enrichment conditional on `d.familyId`; for tutor docs enrich with the uploader's name as `tutorName` (fetch users/{uploadedByUserId} — it may already fetch uploader names; reuse).
  - New composite indexes in `firestore.indexes.json`: `verifications(uploadedByUserId ASC, type ASC, createdAt DESC)` and `verifications(status ASC, type ASC, createdAt DESC)`. NOTE: the emulator auto-serves queries without indexes; the file change is for prod deploy.
- [ ] **Step 3:** Rebuild/restart/green (new file + any existing verification integration tests + enroll files). Commit: `feat(verification): tutor status/document access; robust pending list`

## Task 6: firestore.rules tutorIdentityUnchanged (TDD, rules tests)

**Files:** Modify `firestore.rules`; modify `tests/rules/firestore-rules.test.ts` (find the users-update describe block and the babysitterIdentityUnchanged tests as the pattern).

- [ ] **Step 1 (red):** Rules tests: tutor owner CAN update `profiles.tutor.subjects`, `profiles.tutor.contactEmail`, `profiles.tutor.searchable`; tutor owner CANNOT update `profiles.tutor.enrollmentComplete`, `profiles.tutor.ejemEmail`, `profiles.tutor.verification.identityStatus`. Expect the CANNOT cases to FAIL today (writes currently allowed).
- [ ] **Step 2 (green):** Add `tutorIdentityUnchanged()` mirroring `babysitterIdentityUnchanged()` (firestore.rules:63-68 — read it and copy the `.get()`-chain style exactly, defaulting safely for users without a tutor profile): tutor's `ejemEmail`, `enrollmentComplete`, and `verification` must be unchanged in owner updates. Add it to the users update rule alongside the existing guards. Run the FULL rules suite (`cd tests && ../node_modules/.bin/vitest run rules/`) — all existing + new green. NOTE: babysitter StepPreferences sets `profiles.babysitter.enrollmentComplete` client-side — ensure your guard touches ONLY the tutor slot.
- [ ] **Step 3:** Commit: `feat(rules): server-own tutor enrollmentComplete and verification state`

## Task 7: full gates + PR

- [ ] `pnpm typecheck`; `pnpm test:unit`; full integration + rules suite via emulator recipe (ALL files); `pnpm --filter web lint && pnpm --filter study-web lint` baselines unchanged (1 pre-existing router.tsx error each).
- [ ] Final whole-branch review (cross-cutting: family paths byte-identical, state machine consistent across callables, no client-writable approval state).
- [ ] Push `feature/tutor-portal-backend`, `gh pr create` (body: state machine table, reuse-not-copy rationale, family-path regression evidence, index additions note for deploy, babysitter-status-quo note).

## Self-review checklist (before Task 7)
1. No tutor path reads or writes `families/*`.
2. `verification.identityStatus` transitions exactly per the state machine in every callable.
3. Family callable behavior diffs are additive-only (branch + optional param defaults).
4. Every new/changed callable has integration coverage incl. a family-path regression canary.
5. The rules guard blocks owner writes to all three protected tutor fields and nothing else.
