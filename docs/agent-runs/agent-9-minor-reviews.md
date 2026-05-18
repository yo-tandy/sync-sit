# Agent 9 — Minor Security Reviews Log

This file holds one-paragraph security gate verdicts for changes that don't warrant a full per-PR review doc. Sorted oldest-first. Future light reviews are appended here rather than creating a new file per change.

**Authoring convention:** each entry names the task #, the branch, the HEAD SHA reviewed, and a PASS/BLOCKED verdict in the first line. Body explains what was checked. Keep entries tight — if a review needs more than ~10 lines of body, it belongs in its own `agent-9-phase-N-<topic>-review.md` doc, not here.

---

## Task 16 — Phase 0 workspace bootstrap (agent-6) — **PASS**

**Branch:** `feature/sync-study-infrastructure`
**HEAD reviewed:** `1b27967` (`docs(agent-6): add Phase 0 plan, workspace smoke-test, and completion report`); preceded on the branch by `dcca169` (`chore(workspace): stub sync-study build/dev scripts (Phase 0 bootstrap)`).
**Diff:** 4 files / +597 / -0 (`package.json` +3 lines; three new docs in `docs/agent-runs/`).
**Date:** 2026-05-18.

Verified against the 4 confirms in the work order. **(1) Zero touch on `firestore.rules`, `storage.rules`, `firestore.indexes.json`** — confirmed via `git diff --stat`; the 4 changed files are `package.json` plus three markdown docs, none are rules or index files. **(2) The 3 new scripts are echo stubs** — `dev:study`, `build:study`, and `build:study-functions` each shell `echo 'study-* not yet implemented; see Phase 3 of docs/sync-study-project-plan.md'` and exit. They are documentation placeholders for npm scripts; they cannot connect to or grant access to any cloud surface. **(3) No new secrets / env-vars / service-account references** — the package.json delta contains only three echo strings; no `process.env.X`, no `defineSecret`, no service-account JSON path, no FCM/Resend/Admin-SDK credential introduction. The three new markdown files are non-executable. **(4) No new PII flow or cross-collection write introduced** — there is no executable code change beyond the three echo scripts; the docs may discuss future flows but no Cloud Function code, Firestore client code, or rule change implements them. Closes Phase 0 from Agent 9's perspective.

---

## Task 20 — Phase 1 shared-core + shared-ui extraction (agent-1 + agent-2) — **PASS**

**Branch:** `feature/sync-study-shared-ui` (contains both agents' work).
**HEAD reviewed:** `378e848`.
**Base:** `01ae4db` (Phase -1 HEAD).
**Diff:** 109 files / +5597 / -3219.
**Date:** 2026-05-18.
**Gates already PASSED:** Gate 1 (build, agent-7) all green; Gate 2 (functional, agent-8 `045b741`) L1–L6 + 8-flow smoke pass, publish-hide preserved.

Verified against the 5 confirms in the work order. **(1) Zero touch on rules/indexes/config/scripts/functions** — `git diff --stat 01ae4db..HEAD -- firestore.rules storage.rules firestore.indexes.json firebase.json scripts/ apps/functions/src/` returns empty; no Cloud Function code, no rule, no index, no deploy script touched. **(2) Type moves are clean, no callable contract leaked** — `diff` of `family.ts`, `reference.ts`, `notification.ts`, `verification.ts` between `01ae4db:packages/shared/src/types/` and the post-extraction `packages/shared-core/src/types/` is byte-identical (zero textual delta) for all four. `user.ts` has identical `UserBase`, `ParentUser`, `AdminUser` definitions; the only new addition is the abstract `ServiceProviderBase` which is `BabysitterUser` minus the babysitter-specific fields (no `approvedFamilies`, no `kidAgeRange`, no `maxKids`, no `hourlyRate`) — clean abstraction, no babysitter-specific field leaks into the parent type that future `TutorUser` will also extend. None of the Phase -1 local view-types (`AdminAuditLogEntry`, `WireTimestamp`, `EnrichedAppointment`, `ParentUserView`, etc.) were promoted to shared-core, consistent with Bucket A / Bucket B being deferred per the work order. **(3) No new secrets / env vars / service-account references in the new packages** — `grep -rn "process\.env\|defineSecret\|RESEND_API_KEY\|initializeApp\|getAuth\|getFirestore\|getMessaging\|google-services\|service.*account" packages/shared-core/ packages/shared-ui/` returns no matches. Both packages are pure types/UI as claimed. **(4) No new PII flow** — `grep -rn "addDoc\|setDoc\|updateDoc\|deleteDoc\|httpsCallable\|collection(db" packages/shared-core/ packages/shared-ui/` returns no matches. Zero Firestore writes, zero callable invocations, zero direct Firestore client reads in either new package. **(5) BL-3 / BL-4 closures and WAI-1 / WAI-2 carry forward intact** — `git diff 01ae4db..HEAD -- firestore.rules storage.rules` returns empty: rules are byte-identical to Phase -1 closing state. The forced-`status='private'` create gate, the `['private','removed']`-only update status transitions, the `families` field whitelist, the `users.approvedFamilies` blocklist, and the `searchable` exclusion all continue to hold. No movement on `[BLOCK-LATER-5]`, `[BLOCK-LATER-6]`, `[WORKING-AS-INTENDED-1]`, or `[WORKING-AS-INTENDED-2]`. Phase 1 is the intended no-op for sync-sit's security posture and the no-op holds at every seam.
