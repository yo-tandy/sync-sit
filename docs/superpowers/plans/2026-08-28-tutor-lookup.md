# Direct Tutor Lookup (issue #235, parity A2)

> **For agentic workers:** implemented in this branch; plan recorded for review context.

**Goal:** A family finds a tutor they already know by name or exact email, without a subject search — sit's `lookupBabysitter` ported to study.

**Correction to the issue text:** sit's mechanism is name/email lookup, not a personal code; the port mirrors what actually shipped there.

**Architecture:**
- `lookupTutor` callable (`apps/study-functions/src/search/lookupTutor.ts`):
  parent-only; `profiles.tutor.searchable == true` gate (a hidden tutor stays
  hidden — the #213 reasoning); name-substring OR exact email/ejemEmail
  (`getEjemEmail` on the RAW doc, root-first per issue #203); per-pair
  request status with searchTutors' `'incoming'` idiom (tutor-initiated
  pending is never `'pending'`); <= 10 results. NO family-verification gate,
  mirroring sit: results are display-only and `sendTutorContactRequest`
  (the only next step) enforces `isFullyVerified` itself. No contact fields
  in the payload, ever — resolving never bypasses the two-stage model.
- `TutorLookup` component on the family SearchPage (below the subject
  search; study has no preferred-tutors page by decision C.Q2=a, so the
  lookup lives on the search surface): debounced 400ms input, compact result
  rows, per-status CTA (send dialog / pending chip / incoming link to
  /family/requests / connected chip). The send dialog SELECTS subject+level
  from the tutor's offered list (unlike TutorCard, there is no matched
  subject to inherit) and posts through the ordinary
  `sendTutorContactRequest` flow.

**Tests:** 13 integration pins (gates, match modes, status mapping incl.
incoming, cap, no-contact-fields) + 6 component pins (debounce, rows,
status rendering, chosen-subject payload, error copy).
