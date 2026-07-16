# Study Search + Contact UI (PR C of tutor-search milestone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** study-web families can search tutors, send contact requests, and see revealed contact details; tutors get a requests inbox to accept/decline. Replaces the `/family/search` stub from PR B; consumes the PR A callables.

**Backend contracts (from PR A — do not change them):**
- `searchTutors({subject, level, latLng?, filters?: {locationPref?, maxRate?, maxDistanceKm?}})` → `{results: TutorSearchResult[]}` (type in @ejm/study-core). `requestStatus ∈ 'none'|'pending'|'accepted'|'declined'`; `contactEmail/contactPhone/whatsapp` present ONLY when the tutor approved this family. Errors: permission-denied (not a parent / family unverified).
- `sendTutorContactRequest({tutorUserId, subject, level, message?})` → `{requestId}`. Errors to map: `already-exists` (pending exists), `failed-precondition` (already approved / no live offering), `resource-exhausted` (7-day decline cooldown).
- `respondToTutorContactRequest({requestId, action: 'accept'|'decline'})` → `{success}`.
- `studyContactRequests` docs: client-READABLE by the involved tutor and family members (rules), writes callable-only. Fields: requestId, tutorUserId, familyId, familyName, parentName, **tutorName** (denormalized 0d47876 — families cannot read tutor user docs), createdByUserId, subject, level, message?, status, createdAt, respondedAt?, updatedAt. Composites exist for `(familyId, createdAt desc)` and `(tutorUserId, status, createdAt desc)`.
- Endorsement display reads: `references` where `tutorUserId==uid` + `status in ['approved','published']` — client-readable, index-backed.

**Templates to READ first:** apps/web/src/pages/family/SearchPage.tsx (results-card + contact-dialog + success-dialog idioms — but study is a SINGLE-STEP form, no type/details steps, no kids/date/time); study-web SubjectsPage (taxonomy selects: `SUBJECTS.map(s => ({value: s, label: t(\`tutor.subjects.names.${s}\`)}))` — same idiom for CLASS_LEVELS); PR B family pages (test/mocking conventions, family-doc load, AddressAutocomplete usage in FamilySettingsPage); tutor DashboardPage (card/badge conventions).

**Invariants:** apps/web untouched; no client writes to studyContactRequests/references/users-tutor-fields; every string i18n EN+FR (reuse `tutor.subjects.names.*` for subject labels — do NOT duplicate the taxonomy labels under a family namespace); lint baseline (1 pre-existing router.tsx error); package filter is `study-web` (NOT `@ejm/study-web` — that filter silently matches nothing).

## Task 1: SearchPage (single-step form → results)
- Replace the `/family/search` stub with `src/pages/family/SearchPage.tsx`: subject Select (required), level Select (required), then optional filters: locationPref chip group (reuse the tutor enrollment's locationPrefs values), maxRate number input, maxDistanceKm number input, AddressAutocomplete seeded from `families/{id}.address/latLng` (one getDoc like PR B's dashboard).
- Query-param prefill: read `?subject=&level=` from the URL (useSearchParams); if both valid, prefill and auto-run the search on mount (family RequestsPage deep-links here).
- Submit → `searchTutors` callable; loading state; error mapping (permission-denied → the dashboard's verification-banner copy + link-out; generic otherwise). Results rendered via TutorCard (Task 2). Empty state with "edit search".
- TDD: payload shape (subject/level/latLng/filters), auto-search from query params, error branch renders verification copy, empty state. Mock httpsCallable per the PR B test conventions.
- Commit: `feat(study-web): tutor search page`

## Task 2: TutorCard + ContactRequestDialog
- `src/components/family/TutorCard.tsx`: avatar/name/classLevel/languages/aboutMe (line-clamped, expandable like sit), matched subject+level, rate €/h, sessionLengths, locationPrefs, distance (only when non-null), endorsementCount badge; expanded card lazily loads approved endorsements (`references` client query above) and lists refName + text.
- CTA by `requestStatus`: `none` → "Request contact" (opens dialog); `pending` → disabled "Request pending"; `accepted` → contact block (mailto/tel/wa.me links from the projected fields, sit idiom); `declined` → "Request again" + hint that the tutor declined recently may still be blocked (map `resource-exhausted` from the callable to the cooldown message when tried).
- `ContactRequestDialog`: shows tutor name + subject/level, optional message textarea (≤1000), send → `sendTutorContactRequest`; success dialog (sit idiom, minus contact reveal — study reveals only AFTER acceptance; copy explains the tutor must accept first). On success flip that card's requestStatus to 'pending' locally.
- TDD: one test per CTA state (4), dialog payload incl. message trim/omit, error mapping table (already-exists / resource-exhausted / failed-precondition → distinct i18n strings), local pending flip.
- Commit: `feat(study-web): tutor result card with consent-gated contact CTA`

## Task 3: Family RequestsPage + dashboard wiring
- `src/pages/family/RequestsPage.tsx` at `/family/requests`: getDocs `studyContactRequests` where `familyId==mine` orderBy `createdAt desc` (composite exists); group by status (pending / accepted / declined); each row: tutorName, subject+level (taxonomy labels), sent date, status chip; accepted rows get "View contact details" → deep-link `/family/search?subject=X&level=Y` (auto-search reveals the contact block on that tutor's card).
- DashboardPage: replace the requests placeholder card with live counts (pending/accepted) from the same query; FamilyAppBar menu gains "Requests".
- TDD: query args, grouping, deep-link href, dashboard count rendering.
- Commit: `feat(study-web): family requests list and dashboard wiring`

## Task 4: Tutor RequestsPage + dashboard badge
- `src/pages/tutor/RequestsPage.tsx` at `/tutor/requests`: getDocs where `tutorUserId==me` orderBy `createdAt desc`; pending section on top with familyName/parentName/subject+level/message + Accept / Decline buttons (confirm dialog for decline); call `respondToTutorContactRequest`; optimistic status update + error rollback. History section below (accepted/declined).
- Tutor DashboardPage: pending-requests count card → /tutor/requests; AppBar menu item.
- Gate note: an unapproved tutor (enrollmentComplete false) can technically receive no requests, so no extra gating needed — but AuthGuard already covers role.
- TDD: accept payload, decline payload, optimistic flip + rollback on error, pending-count card.
- Commit: `feat(study-web): tutor requests inbox with accept/decline`

## Task 5: gates + review + PR
- Full study-web suite + typecheck + lint baseline; i18n parity (new `family.search.*`, `family.requests.*`, `tutor.requests.*` namespaces EN+FR).
- Whole-branch review (apps/web untouched; no direct writes; taxonomy labels not duplicated).
- Push + PR. Body: lifecycle diagram (search → request → accept → reveal), PR A/B dependency note, deep-link contract, follow-ups (family-side cancel of pending; live onSnapshot for requests; tutor geocoding).
- BEFORE merge: controller runs the FE browser smoke (family login → search finds tutor2 → request → tutor accepts → contact revealed → deep-link from requests page).
