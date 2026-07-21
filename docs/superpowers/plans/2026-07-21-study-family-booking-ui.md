# Study Family Booking UI (PR 6 of session-booking milestone — feature goes LIVE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** families book sessions: a "Book a session" entry on accepted-tutor contexts, an availability calendar fed by getTutorAvailability, a booking form (one-time + weekly modes), a family sessions list with cancellation, and dashboard wiring. This PR makes the whole booking feature reachable — the milestone browser smoke gates the merge.

**Backend contracts (do not change):**
- `getTutorAvailability({tutorUserId, startDate, endDate})` → `{dates:[{date, slots: boolean[96]}]}` — approval-gated, range ≤28 days, sanitized.
- `bookSession` one_time: {tutorUserId, subject, level, date, startTime, sessionLengthMinutes, location, studentIds, address?, latLng?, message?}; recurring: {tutorUserId, subject, level, type:'recurring', recurringSlot:{day,startTime}, schoolWeeksOnly, endDate?, sessionLengthMinutes, location, studentIds, …}. Errors: invalid-argument ('slot not available' / zero candidates), already-exists (duplicate pending), failed-precondition (notice/offering/length/location), permission-denied (approval).
- `cancelSession({sessionId, reason ≥3})`, `cancelSessionInstance({sessionId, instanceId(=date), reason ≥3})` → cancelled_by_family.
- study-sessions readable by family members; instances via NESTED per-series path only (no client CG).
- Client helpers: @ejm/shared-core timeToSlotIndex/slotIndexToTime/areSlotsAvailable; the family knows tutor offerings from search results / the request doc (subject+level+rate) — sessionLengthsMin and locationPrefs come from the TutorSearchResult card context or must be re-derived: READ what the accepted-request row and TutorCard carry; the booking form needs sessionLengths + locations for ITS tutor — pass them via navigation state from the TutorCard (search results carry sessionLengthsMin + locationPrefs) AND fall back to a fresh searchTutors call when absent (deep-link entry from RequestsPage: subject+level are on the request doc → auto-search returns the tutor's card data). DECIDE the cleanest wiring per what exists; document it.

**Templates to READ first:** apps/study-web/src/pages/family/{RequestsPage,SearchPage}.tsx + components/family/TutorCard.tsx (accepted-context entries, deep-link prefill, dialog/error conventions); pages/tutor/SessionsPage.tsx + types/studySession.ts (session rendering, non-optimistic cancels, reason modal — REUSE the client types); tutor SchedulePage (slot-grid rendering idiom if one exists client-side).

**Invariants:** apps/web untouched; reads + callables only; NO client CG queries; non-optimistic everything; i18n EN+FR; lint baseline; filter `study-web`.

## Task 1: BookSessionPage — availability calendar + one-time booking
- Route `/family/book/:tutorUserId` under FamilyLayout (guarded by approval implicitly — getTutorAvailability rejects unapproved; map permission-denied to a friendly 'request contact first' screen with a link to search). Entry points: TutorCard accepted-state gains a 'Book a session' button (passes subject/level/rate/sessionLengthsMin/locationPrefs via router state); family RequestsPage accepted rows gain 'Book a session' (navigates with the request's subject/level; card data re-derived per the contract note).
- Form top: subject·level (prefilled, display-only in v1 — booking is per the accepted context), students multi-select (kids loaded like FamilySettingsPage), sessionLength select (tutor's sessionLengthsMin), location select (tutor's locationPrefs; family_home shows the family address note), optional message.
- Calendar: two-week window pager (getTutorAvailability in 14-day pages, ≤28 cap respected); per day, derive valid START times for the chosen sessionLength via areSlotsAvailable over the boolean grid; render as date columns → time-chip lists; picking a chip arms the Book button. Re-derive chips when sessionLength/location changes.
- Submit → bookSession one_time; success dialog ('Request sent — {tutor} must confirm'); error mapping (slot-taken invalid-argument → refresh the calendar page + message; already-exists; failed-precondition variants by code to one message; permission-denied → the friendly screen).
- TDD red-first: availability-to-chips derivation (a crafted grid + length → exact chip set; boundary at day edges), payload exactness, error mapping incl. calendar refresh on slot-taken, students multi-select payload, permission-denied screen.
- Commit: `feat(study-web): family booking page with availability calendar`

## Task 2: weekly (recurring) mode
- Mode toggle One-time / Weekly. Weekly: day-of-week + start-time picker derived from the SAME availability pages (a weekly slot is offered when its start is free in ≥3 of the next 4 occurrences — client heuristic, commented; server authoritative), schoolWeeksOnly toggle (default ON), optional endDate (date input ≥ first occurrence), projection panel: next-8-dates list with holiday weeks greyed ('skipped — school holidays') via useHolidays, and the copy that conflicting dates are skipped at confirm.
- Submit → bookSession recurring; success dialog states weekly cadence + that the tutor confirms.
- TDD: weekly-slot derivation from crafted grids (incl. a <3/4 slot NOT offered), projection panel holiday greying, payload (recurringSlot/schoolWeeksOnly/endDate omit-when-empty), default-ON schoolWeeksOnly.
- Commit: `feat(study-web): weekly recurring booking mode`

## Task 3: family SessionsPage + dashboard wiring
- `/family/sessions` under FamilyLayout (AppBar item + dashboard card with pending/upcoming counts). Query study-sessions where familyId==mine (equality + client sort). Sections mirror the tutor page from the family perspective: Pending (awaiting tutor — with tutorName; cancellable via cancelSession), Upcoming (one_time + series interleaved; series expand to instances via nested path; per-date cancel + series cancel), History. REUSE src/types/studySession.ts and the tutor page's reason-modal/non-optimistic idioms (factor shared pieces into components/sessions/* where clean — e.g. the ReasonModal and instance-list renderer; do NOT copy-paste two 300-line twins).
- Family RequestsPage accepted rows: 'Book a session' entry (from Task 1) — verify it landed; dashboard requests card unchanged.
- TDD: query args, sections, cancel payloads (cancelled_by_family side), factored-component reuse (tutor page tests still green after the refactor), counts card.
- Commit: `feat(study-web): family sessions list with cancellation and dashboard wiring`

## Task 4: gates + push
- Full study-web suite (baseline 185 + yours) + typecheck + lint baseline + i18n parity (family.book.*, family.sessions.* EN+FR). Push feature/study-family-booking-ui. NO PR.
- The controller then runs the FULL MILESTONE BROWSER SMOKE before the PR merges: family books one-time → tutor confirms → slot blocked in family availability view → family books weekly (with a holiday inside the window) → tutor previews conflicts + confirms with skips → instances visible both sides → family cancels one date → tutor sees it cancelled → slot restored in availability → reminders/completion asserted via emulator REST where practical.
