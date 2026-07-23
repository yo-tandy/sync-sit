# Study Backend Debt (Hardening PR H4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** three ledgered study-backend items: (1) families can cancel their own PENDING contact requests; (2) `endorsementCount` denormalized onto the tutor profile so searchTutors stops scanning the references collection per call; (3) tutor enrollment geocodes the area address so real tutors have `areaLatLng` and search distance stops being null.

**Templates to READ first:** apps/study-functions/src/contact/{sendTutorContactRequest,respondToTutorContactRequest}.ts; endorsements/{submitTutorEndorsement,respondToTutorEndorsement}.ts; search/searchTutors.ts (the per-call references scan to remove); enrollment/enrollTutor.ts (where areaAddress is stored — find how sit geocodes; sit families get latLng from AddressAutocomplete CLIENT-side, so check what the tutor enrollment wizard sends: if the client already sends latLng from AddressAutocomplete, the fix may be wiring/validation, not server geocoding — AUDIT FIRST and report which); tests/integration/study-contact/* and references/* (idioms + counts baseline).

## Task 1: cancelContactRequest callable (TDD)
- `contact/cancelContactRequest.ts`: input {requestId}. Gates: auth → parent+familyId → request exists → request.familyId == callerFamilyId (permission-denied) → status == 'pending' (failed-precondition 'Only pending requests can be cancelled'). Transaction: status → 'cancelled' + cancelledAt + updatedAt (NEW status value — add 'cancelled' to StudyContactRequestStatus in study-core with a comment; it is FAMILY-initiated, distinct from tutor 'declined'; the 7-day decline cooldown does NOT apply to cancelled — a family may re-request immediately after cancelling; verify sendTutorContactRequest's cooldown logic keys on 'declined' only and add a test pinning that a cancelled request does not block re-sending).
- Notify the tutor (cancelled prefs, house pattern); audit. Register in both index files.
- searchTutors requestStatus mapping: 'cancelled' must map to 'none' (the family can re-request) — the KNOWN_REQUEST_STATUSES whitelist already falls back to 'none' for unknown values; change it to EXPLICITLY include 'cancelled'→'none' semantics (comment why) and pin with a test.
- Family RequestsPage UI: pending rows gain a 'Cancel request' action (ReasonModal NOT needed — no reason field on this callable; a simple confirm dialog per the house pattern), non-optimistic. i18n EN+FR.
- Tests: happy path; wrong family; non-pending (accepted/declined/cancelled) rejected; re-send after cancel succeeds immediately (cooldown pin); tutor notification; page test for the UI action payload.
- Commit: `feat(study): families can cancel pending contact requests`

## Task 2: endorsementCount denormalization (TDD)
- Add `endorsementCount?: number` to TutorProfile (study-core, comment: server-owned counter of approved/published study endorsements; add to the tutorIdentityUnchanged rules pin — a client must not inflate it: firestore.rules tutorIdentityUnchanged gains the equality clause, red-first rules test 'tutor cannot change own endorsementCount').
- respondToTutorEndorsement: accept → transaction also increments users/{tutorUserId} profiles.tutor.endorsementCount (FieldValue.increment(1)); dismiss → no change. (Nothing decrements in v1 — 'removed' only happens pre-approval via dismiss; if an approved endorsement is ever removed by future admin moderation, that flow owns the decrement. Comment this.)
- searchTutors: REPLACE the references collection scan with reading `tutor.endorsementCount ?? 0` from the already-loaded profile. Delete the scan block.
- Backfill: existing approved endorsements in prod predate the counter. Write `scripts/backfill-endorsement-counts.ts` (one-shot, Admin SDK, idempotent: recompute per tutor from a references query and SET the counter; dry-run flag default ON, mirrors the repo's existing migration-script conventions — find one and match). The USER runs it in prod; note it in the deploy section.
- Tests: accept increments (and search reflects it — adapt the existing cross-callable test which currently proves the scan; it must now prove the counter path); dismiss doesn't; rules red-first pin; searchTutors returns counter value even when the references collection is emptied out-of-band (proves the scan is gone).
- Commit: `feat(study): denormalized endorsement counts replace the per-search references scan`

## Task 3: tutor areaLatLng (audit-first, then fix where it lives)
- AUDIT: read the tutor enrollment wizard's area step (apps/study-web enrollment) + enrollTutor's validation. Determine why areaLatLng is absent for real tutors: (a) the client never collects it (no AddressAutocomplete on the area step) → fix CLIENT: use AddressAutocomplete (the component exists in study-web), send {areaAddress, areaLatLng}; (b) the client sends it but enrollTutor drops it → fix the callable/zod. Report which before implementing.
- Also cover the tutor AccountPage/SubjectsPage if the area is editable post-enrollment (find where areaAddress can change; the same fix applies there).
- Validation: latLng bounds (reuse the search zod's lat/lng bounds). searchTutors already handles both null and present areaLatLng — no search change.
- Tests: enrollment payload carries areaLatLng from the address pick (page test); enrollTutor persists it (integration); bounds rejection.
- Commit: `fix(study): tutor enrollment captures area coordinates for search distance`

## Task 4: gates + push
- FULL emulator integration+rules suite (baseline 521/61 — post-#94; if #94 is unmerged when you branch-check, baseline is 500/61 — verify what main has and report the number); study-web + web suites; typecheck; lint baselines. Push feat/study-backend-debt. NO PR.
