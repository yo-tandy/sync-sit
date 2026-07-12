# Tutor Search Backend (PR A of tutor-search milestone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** The five backend callables making the study marketplace two-sided: `searchTutors` (subject-first, approval-gated), `sendTutorContactRequest` / `respondToTutorContactRequest` (consent flow → `profiles.tutor.approvedFamilies` unlocks contact fields), `submitTutorEndorsement` / `respondToTutorEndorsement` (references-collection reuse with tutor keys). Plus rules, indexes, seed, and a ~45-case test matrix.

**Templates to READ before each task** (adapt, don't invent): `apps/functions/src/search/searchBabysitters.ts` (caller gate at :74-89, slot/index helpers, contact gating :199-201, sorting :223-227), `apps/functions/src/family/respondToContactSharing.ts` + `apps/functions/src/family/addPreferredBabysitter.ts` (accept→arrayUnion mechanism), `apps/functions/src/references/submitFamilyEndorsement.ts` (endorsement shape; the appointment gate gets swapped), `packages/shared-functions/src/config/{email,push}.ts` + `notifyParents.ts` (notification helpers — importable from study-functions), the tutor-portal-backend plan's callable style (dual-mode enrollTutor, verification callables).

**Standing recipes:** identical to prior plans (builds all six packages; emulator start/poll/kill; `cd tests && ../node_modules/.bin/vitest run <path>`; rebuild + restart emulators between red and green; UPPERCASE error-code assertions; `callFunction`/`getIdToken`/`getAdminAuth`/seed helpers in tests/setup/).

**Invariants:**
- Tutor visibility: results iff `status=='active' && profiles.tutor.enrollmentComplete==true && profiles.tutor.searchable==true`. enrollmentComplete is THE approval gate — dedicated positive/negative tests.
- Contact fields (contactEmail/contactPhone/whatsapp) projected ONLY when `profiles.tutor.approvedFamilies` includes the caller's familyId.
- `approvedFamilies` is server-owned: written only by respondToTutorContactRequest; rules guard blocks owner writes.
- No sit collection/query touched; sit tests stay green.
- All family-side gates: caller has parent profile + `families/{id}.verification.isFullyVerified` (permission-denied otherwise — hard, no soft path).

---

## Task 1: study-core types + seed

**Files:** `packages/study-core/src/types/{tutorProfile.ts,contactRequest.ts(new),endorsement.ts(new),searchResult.ts(new)}`, `packages/study-core/src/index.ts`, `tests/setup/seed.ts`.

- [ ] tutorProfile.ts: add `approvedFamilies?: string[]` (JSDoc: server-owned, written by respondToTutorContactRequest, guarded by rules).
- [ ] contactRequest.ts: `StudyContactRequestStatus = 'pending'|'accepted'|'declined'`; `StudyContactRequestDoc { requestId, tutorUserId, familyId, familyName, parentName, createdByUserId, subject, level, message?, status, createdAt, respondedAt?, updatedAt }` (check what sit request docs carry for display — familyPhotoUrl? mirror what the tutor RequestsPage will need).
- [ ] endorsement.ts: `TutorEndorsementDoc` mirroring the references doc shape (READ `packages/shared-core/src/types/reference.ts` first) with `tutorUserId`, `appSource: 'study'`, `submittedByFamilyId`, `subject?`; status vocabulary identical to references.
- [ ] searchResult.ts: `TutorSearchResult { uid, firstName, lastName, photoUrl?, languages, aboutMe?, classLevel, subject, level, rate, levels, sessionLengthsMin, locationPrefs, distance: number|null, endorsementCount, requestStatus: 'none'|'pending'|'accepted'|'declined', contactEmail?, contactPhone?, whatsapp? }`.
- [ ] Seed: add `tutor2` (VERIFIED: enrollmentComplete true, searchable true, identityStatus approved, subjects `[{subject:'math',levels:['6e','5e','4e'],rate:25},{subject:'english',levels:['6e'],rate:22}]`, sessionLengthsMin [45,60], locationPrefs ['online','family_home'], areaMode 'distance' + areaLatLng near Paris center + areaRadiusKm 5, languages ['French','English'], paddingMin 15, contact fields) and `tutor3` (verified but `searchable:false`); auth users for both; schedules docs; expose on SeedData. Add `seedStudyContactRequest(overrides)` helper mirroring the file's existing helper style.
- [ ] Gates: build study-core; `pnpm typecheck`. Commit: `feat(study-core): contact-request, endorsement, search types; verified tutor seeds`

## Task 2: searchTutors (TDD)

**Files:** create `apps/study-functions/src/search/searchTutors.ts` + `apps/study-functions/src/validation/search.ts`; modify `apps/study-functions/src/index.ts`; create `tests/integration/search/search-tutors.test.ts`.

- [ ] Validation (zod): `{ subject: enum SUBJECTS, level: enum CLASS_LEVELS, latLng?: {lat,lng}, filters?: { locationPref?: enum, maxRate?: positive number, maxDistanceKm?: positive number } }`.
- [ ] Callable per the design: caller gate (parent + verified family, hard permission-denied for non-parents); query users by the three equality filters (no composite index needed); per-candidate: match offering (subject && level in offering.levels) else skip; apply filters; distance = haversine when areaMode 'distance' && areaLatLng && params.latLng (exclude > min(areaRadiusKm ?? 5, maxDistanceKm ?? ∞)), arrondissement mode includes-all (same TODO comment as sit), null otherwise; endorsementCount from `references where appSource=='study' && status in ['approved','published']` grouped by tutorUserId (one query, count in memory); requestStatus from `studyContactRequests where familyId==caller` latest-per-tutor; contact fields per approvedFamilies. haversineDistance: check where it lives (@ejm/sit-core?) — if sit-core-only, MOVE it to shared-core with a sit-core re-export (mirroring the taxonomy-constants move pattern) so study-functions doesn't import sit-core for it... check study-functions deps first; if it already depends on sit-core, just import. Sort: distance asc nulls-last, then endorsementCount desc. Audit `writeUserActivity(uid,'search_tutors',{subject,level})`. Return `{ results }`.
- [ ] Tests (red first): unauthenticated; tutor-token caller → PERMISSION_DENIED; unverified family (seed.parent3's family per the sit search test) → PERMISSION_DENIED; happy path returns tutor2 ONLY (tutor1 excluded by enrollmentComplete false, tutor3 by searchable false) — the approval-gate test; wrong subject excluded; right subject wrong level excluded; maxRate 20 excludes tutor2's math@25; locationPref 'library' excludes; endorsementCount 0 baseline (endorsement counting re-asserted in Task 5); requestStatus 'none' baseline; NO contact fields present; payload spot-check: no babysitter fields, rate is the MATCHED subject's rate.
- [ ] Gates: green run new file + `search-babysitters.test.ts` (sit regression) + typecheck. Commit: `feat(study-functions): subject-first tutor search with approval gating`

## Task 3: contact-request lifecycle (TDD)

**Files:** create `apps/study-functions/src/contact/{sendTutorContactRequest.ts,respondToTutorContactRequest.ts}` + validation; modify index.ts; create `tests/integration/study-contact/{send,respond}-tutor-contact-request.test.ts` (two files).

- [ ] send: input `{tutorUserId, subject, level, message? ≤1000}` (NO familyId from client — derive from caller's parent profile). Gates in order: auth; parent+verified family; tutorUserId !== caller uid; tutor doc active + enrollmentComplete; tutor's live subjects contain subject+level (failed-precondition 'Tutor does not offer this subject/level'); no pending request for (familyId,tutorUserId) → already-exists; familyId not already in approvedFamilies → failed-precondition; if latest request for the pair is declined and < 7 days old → resource-exhausted with a clear message. Write the doc (denormalize familyName + parentName for the tutor's list); notification to the tutor: `notifications` doc type 'study_contact_request' + email/push per notifPrefs.newRequest (mirror sendContactRequest.ts:126-173 — READ it); audit. Return `{requestId}`.
- [ ] respond: input `{requestId, action:'accept'|'decline'}`. Transaction: load request, `tutorUserId===caller` else permission-denied, `status==='pending'` else failed-precondition; update status+respondedAt; on accept ALSO (in the same transaction) update `users/{caller}` `'profiles.tutor.approvedFamilies': arrayUnion(familyId)` — verify FieldValue.arrayUnion works inside tx.update (it does). After the tx: notifyAllParents of the family (accept → prefCategory 'confirmed', type 'study_request_accepted', email includes the tutor's contact fields — mirror respondToRequest.ts:94-119; decline → 'cancelled'/'study_request_declined', no contact info). Audit. Return `{success:true}`.
- [ ] Test matrices per the design (send: happy incl. doc fields + notification doc; each gate negative; duplicate pending; already-approved; cooldown inside/outside 7 days — seed the prior declined request with a backdated createdAt via the seed helper; oversized message. respond: accept flips status + approvedFamilies + parent notification docs; decline flips status only; wrong tutor; double-respond both orders; unknown id).
- [ ] Gates: green both files + sit regression canaries (respond-to-contact-sharing.test.ts stays green) + typecheck. Commit: `feat(study-functions): tutor contact-request lifecycle with consent-gated contact sharing`

## Task 4: endorsement callables (TDD)

**Files:** create `apps/study-functions/src/endorsements/{submitTutorEndorsement.ts,respondToTutorEndorsement.ts}` + validation; modify index.ts; create `tests/integration/references/{submit,respond}-tutor-endorsement.test.ts`.

- [ ] submit: input `{tutorUserId, referenceText ≥10, refName, subject?}`. Gates: auth; parent+familyId (verified-family NOT required here — the relationship gate is stronger); not self; tutor profile exists; `callerFamilyId ∈ profiles.tutor.approvedFamilies` else permission-denied 'Endorsements require an accepted contact request'; dedup one per (submittedByFamilyId,tutorUserId) → already-exists. Write `references/{id}` with `{referenceId, type:'family_submitted', appSource:'study', status:'private', tutorUserId, submittedByUserId, submittedByFamilyId, submittedByName, refName, referenceText, subject??null, isEjmFamily (copy how sit computes it — READ submitFamilyEndorsement), createdAt, updatedAt}` — NO babysitterUserId key at all. Notify tutor inline (the sit onReferenceCreated trigger early-returns without babysitterUserId — VERIFY that in apps/functions/src/references/onReferenceCreated.ts or wherever it lives, cite in a comment). Audit. Return `{referenceId}`.
- [ ] respond: input `{referenceId, action:'accept'|'dismiss'}`. Gates: `ref.tutorUserId===caller`; `type==='family_submitted'`; `status==='private'`. accept → status 'approved' + approvedAt; dismiss → 'removed'. Audit. Return `{ok:true}`.
- [ ] Tests: submit happy (private doc, correct keys, tutor notification); not-approved family rejected; dedup; short text; self; non-parent. respond: accept→approved; dismiss→removed; wrong caller; already-responded. PLUS the cross-callable case: after accept, `searchTutors` returns endorsementCount 1 for tutor2 (and 0 while private) — this closes Task 2's counting assertion.
- [ ] Gates: green both files + sit references regression (submit-family-endorsement tests stay green) + typecheck. Commit: `feat(study-functions): tutor endorsements via shared references collection`

## Task 5: rules + indexes (TDD rules tests)

**Files:** `firestore.rules`, `firestore.indexes.json`, `tests/rules/firestore-rules.test.ts`.

- [ ] Rules: (1) `tutorIdentityUnchanged()` gains an `approvedFamilies` equality guard (mirror the babysitter guard's approvedFamilies pin at :63-68). (2) references update rule immutable-tuple (:208-210 area) gains `'tutorUserId','appSource','submittedByFamilyId'`. (3) New `studyContactRequests` block: read for tutorUserId-match, isFamilyMember(familyId), or admin; `allow create, update, delete: if false`.
- [ ] Rules tests red-first: tutor owner cannot write profiles.tutor.approvedFamilies (currently CAN — red); submitter cannot flip tutorUserId/appSource on their reference doc (red); studyContactRequests: tutor reads own, family member reads own family's, stranger denied, client writes denied; regression: existing suite stays green.
- [ ] Run the `firebase-security-rules-auditor` skill on the diff (controller does this at review).
- [ ] Indexes: `studyContactRequests(tutorUserId,status,createdAt desc)`, `(familyId,createdAt desc)`, `(familyId,tutorUserId,createdAt desc)`; `references(tutorUserId,createdAt desc)`. Existing entries untouched; valid JSON.
- [ ] Gates: FULL rules suite; typecheck. Commit: `feat(rules): study contact requests; server-own approvedFamilies; endorsement immutability`

## Task 6: full gates + final review + PR

- [ ] `pnpm typecheck`; `pnpm test:unit`; FULL emulator integration+rules suite (everything incl. all sit suites); lint baselines (1 pre-existing error per app).
- [ ] Final whole-branch review (cross-cutting: no sit behavior change, state machines coherent, notification fan-outs correct, indexes match every non-equality query) + security-rules audit of the rules diff.
- [ ] Push `feature/tutor-search-backend`; PR body: architecture decisions (references reuse w/ tutor keys, new studyContactRequests, approvedFamilies mechanism), the contact-request state machine, test-matrix summary, deploy note (indexes with functions), follow-ups (family-cancel of pending requests; tutor geocoding for distance; endorsement admin moderation).

## Self-review checklist
1. Contact fields never in results without approvedFamilies membership.
2. enrollmentComplete filtered in search AND re-checked in send-contact.
3. No sit file modified except firestore.rules/indexes (additive) and seed.ts (additive).
4. Every non-equality Firestore query has a composite index entry.
5. All five callables audit-log; notifications respect notifPrefs categories.
