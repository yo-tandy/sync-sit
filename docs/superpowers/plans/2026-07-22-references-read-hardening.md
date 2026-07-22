# References Read Hardening (Hardening PR H2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** close the ledgered exposure — `references` has `allow read: if isAuth()`, so ANY authenticated user can read PRIVATE and REMOVED endorsements (referenceText, submittedByName, submittedByFamilyId; sit and study both), and the tutor-keyed composite makes harvesting efficient. Restrict reads to: publicly-visible statuses OR involved parties OR admin — WITHOUT breaking a single existing client query (rules provability: every allowed client query must carry constraints that prove its disjunct).

**The provability discipline (hard-won this session):** a client LIST is allowed only if the rules engine can prove the read rule for every possible matching doc from the QUERY CONSTRAINTS alone. Unfiltered or under-filtered lists are denied even when every actual doc would pass (the PR6 smoke bug). So this PR = audit every client query FIRST, design the rule to be provable for each, add filters where a query is under-constrained, and pin everything with rules tests + page tests on the query args.

## Task 1: client-query audit (read-only; produce the matrix in the PR description)
Grep BOTH apps for every `collection(db, 'references')` / references query. Known sites to verify (find any others):
- apps/web SearchPage `loadRefs`: where babysitterUserId==uid AND status in ['approved','published'] — provable via the public-status disjunct alone. Confirm exact filters.
- apps/web babysitter references/manual-reference pages (find them): likely where babysitterUserId==OWN uid — provable via involved-party (owner) disjunct.
- study TutorCard endorsements: tutorUserId==uid AND status in ['approved','published'] — public-status disjunct.
- study tutor EndorsementsPage: tutorUserId==OWN uid (all statuses) — involved-party disjunct (tutor).
- study family RequestsPage "Your endorsements": submittedByFamilyId==mine AND appSource=='study' — needs an isFamilyMember(resource.data.submittedByFamilyId) disjunct in the rule (get() per doc — provable with the equality filter).
- Admin surfaces (apps/web admin): find any references reads; admin disjunct covers, but admin LISTS must be provable — isAdmin() is doc-independent → provable for any query. Confirm the admin pages' queries.
Deliverable: a table (query site → filters → which disjunct proves it → change needed?).

## Task 2: the rule + red-first tests
- firestore.rules references read becomes:
  `allow read: if isAuth() && (resource.data.status in ['approved','published'] || resource.data.get('babysitterUserId','') == request.auth.uid || resource.data.get('tutorUserId','') == request.auth.uid || resource.data.get('submittedByUserId','') == request.auth.uid || isFamilyMember(resource.data.get('submittedByFamilyId','__none__')) || isAdmin());`
  — .get() defaults so mixed sit/study docs never error; the '__none__' sentinel makes the family get() a clean miss (verify isFamilyMember on a nonexistent family errors→false in || position per house patterns; if it hard-errors the whole rule, guard with a has-key check instead — TEST THIS EXPLICITLY at red stage).
- Red-first rules tests: stranger reads a PRIVATE study endorsement → DENIED (currently ALLOWED — genuine red); stranger reads a REMOVED one → denied (red); stranger reads an APPROVED one → still allowed; owner-tutor reads own private → allowed; submitter reads own private → allowed; family-member-of-submitting-family reads own family's private (submittedByUserId is the OTHER parent) → allowed; admin unfiltered LIST → allowed; the exact client QUERIES from the audit replayed as rules tests (list-mode with the real filters) → all allowed; an unfiltered non-admin list → denied.
- If the audit found any under-constrained client query, fix that page's query in the same PR (add the provable filter + a page test pinning the where args, per the PR6 pattern).
- Commit: `fix(rules): references readable only via public status, involvement, or admin`

## Task 3: gates + push
- FULL emulator integration+rules suite (baseline 500/61 + new rules tests; every references-touching integration test must still pass — searchTutors endorsementCounts is Admin SDK, unaffected, but confirm); affected web/study-web page tests green; typecheck; lint baselines.
- Push. NO PR — controller reviews and opens it. PR description carries the audit matrix.
