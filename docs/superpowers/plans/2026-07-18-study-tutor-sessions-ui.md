# Study Tutor Sessions UI (PR 5 of session-booking milestone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** the tutor side of session booking in study-web: a sessions hub (pending requests with a recurring conflict preview, upcoming, history), accept/decline with skipped-dates feedback, series management with per-instance and series cancellation. Families still cannot book (PR 6) — a tutor with no requests sees empty states.

**Backend contracts (from PRs 2-4 — do not change):**
- `respondToSession({sessionId, action:'confirm'|'decline'})` → one_time `{success}`; recurring `{success, confirmed, scheduledDates, skippedDates}`. Errors: failed-precondition ('This time is no longer available' / 'This request is too close to the session time' / already-resolved), permission-denied, not-found.
- `cancelSession({sessionId, reason ≥3})`, `cancelSessionInstance({sessionId, instanceId, reason ≥3})` → cancelled_by_tutor when the tutor calls.
- Docs: study-sessions readable by the tutor (rules); instances via the NESTED path per-series (no CG client rule — do NOT write a collectionGroup query in the client). SessionDoc: type one_time|recurring, status pending|confirmed|declined|cancelled|completed, date?/startTime/endTime?, recurringSlots[{day,startTime,endTime}], schoolWeeksOnly, endDate?, familyName/parentName/students, rate, location, message?, statusReason. InstanceDoc (id=date): date, startTime/endTime, status scheduled|cancelled|completed, statusReason ('conflict_skip' = tutor-side conflict), cancellationReason.
- Conflict preview inputs (tutor reads their OWN schedule/overrides/sessions by rules): reuse @ejm/study-core `computeDayAvailability`/`expandRecurringDates` + shared-core slot helpers CLIENT-SIDE to preview "N of 8 dates available" before accepting a recurring request. Note: client preview only — the callable is authoritative; copy must say conflicting dates are skipped automatically.

**Templates to READ first:** apps/study-web/src/pages/tutor/RequestsPage.tsx (non-optimistic actingId respond pattern, confirm dialog, dual-path formatDate — the DIRECT template); EndorsementsPage (sectioned lists); tutor DashboardPage (count cards); family RequestsPage (status chips); i18n conventions.

**Invariants:** apps/web untouched; reads + callables only; non-optimistic EVERYTHING (accepted-state is commitment); i18n EN+FR parity; lint baseline (router.tsx error may line-shift); filter `study-web` not `@ejm/study-web`; taxonomy labels via tutor.subjects.names.*.

## Task 1: SessionsPage — pending inbox + respond
- `src/pages/tutor/SessionsPage.tsx` at `/tutor/sessions` (router + AppBar 'Sessions' item + dashboard count card for pending sessions, mirroring the requests card). Query study-sessions where tutorUserId==me (client-sort desc by createdAt — the (tutorUserId,status,date) composite can't serve orderBy createdAt; equality-only + client sort like RequestsPage).
- Pending section: card per request — familyName/parentName, subject·level taxonomy label, students (names+ages), rate €/h, location label, message; one_time → date+time; recurring → weekly slot ('Every Monday 17:00–18:00'), schoolWeeksOnly badge, endDate if set, and the CONFLICT PREVIEW (Task 2 component — stub a placeholder this task). Accept + Decline buttons, decline behind a confirm dialog; respond via respondToSession, non-optimistic actingId per row; on recurring confirm show the returned scheduledDates count + skippedDates list in a result dialog ('6 of 8 dates scheduled; skipped: …').
- TDD red-first per RequestsPage test conventions: query args, pending render one_time vs recurring, respond payloads, non-optimistic in-flight (deferred promise), error mapping (slot-taken failed-precondition → distinct message), skipped-dates dialog rendering from a mocked recurring response.
- Commit: `feat(study-web): tutor sessions inbox with respond flow`

## Task 2: recurring conflict preview
- `src/components/tutor/RecurringConflictPreview.tsx`: given a pending recurring session, loads the tutor's own schedule doc + overrides + their confirmed sessions/instances for the next 8 candidate dates (nested reads, own-uid — rules permit), expands candidates via expandRecurringDates (schoolWeeksOnly + holidays via the useHolidays hook), runs computeDayAvailability per date client-side, renders '6 of 8 dates available' + a per-date list (available / conflict / holiday-skip) with the disclaimer copy.
- TDD: mocked schedule/overrides → expected per-date statuses; holiday date shows as skip; loading state.
- Wire into Task 1's pending card replacing the stub.
- Commit: `feat(study-web): client-side recurring conflict preview`

## Task 3: upcoming + history + series management + cancellation
- SessionsPage upcoming tab/section: confirmed one_time sessions (date >= today) interleaved with scheduled instances fetched per-series via the nested subcollection path, sorted by date; each row → date/time/family/location. Series cards expand to their instance list (status chips incl. conflict_skip as 'skipped'); per-instance 'Cancel this date' + series-level 'Cancel series' + one_time 'Cancel session' — ALL behind reason-required modals (textarea ≥3 chars), calling cancelSession / cancelSessionInstance, non-optimistic, error + re-enable on reject.
- History section: declined/cancelled/completed parents (+ completed instances inside series cards), read-only.
- TDD: interleaving/sort, instance list render, each cancel payload (reason trim), reason-required client gate, non-optimistic flips, history read-only.
- Commit: `feat(study-web): tutor session management with cancellation flows`

## Task 4: gates + push
- Full study-web suite (baseline 161 + yours) + typecheck + lint baseline + i18n parity (tutor.sessions.* EN+FR). Push feature/study-tutor-sessions-ui. NO PR — controller final-reviews and opens it.
