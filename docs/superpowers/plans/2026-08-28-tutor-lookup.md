# Direct Tutor Lookup (issue #235, parity A2)

> **For agentic workers:** implemented in this branch; plan recorded for review context.

**Goal:** A family finds a tutor they already know by name or exact email, without a subject search — sit's `lookupBabysitter` ported to study.

**Correction to the issue text:** sit's mechanism is name/email lookup, not a personal code; the port mirrors what actually shipped there.

**Architecture:**
- `lookupTutor` callable (`apps/study-functions/src/search/lookupTutor.ts`):
  parent-only; zod-validated input (`lookupTutorSchema`, 2..200 chars);
  `searchable == true` AND `enrollmentComplete == true` gates (searchTutors'
  filter set — a hidden tutor stays hidden, the #213 reasoning; legacy
  dev/test docs never resolve); name-substring OR exact email/ejemEmail
  (`getEjemEmail` on the RAW doc, root-first per issue #203); per-pair
  request status resolved EXACTLY like searchTutors (latest request wins by
  createdAt; tutor-initiated pending is `'incoming'`; family-initiated
  declined surfaces as `'declined'` with the request-again CTA + cooldown
  hint); <= 10 results; `writeUserActivity('lookup_tutor')` audit on every
  call (query length + hit count, never the query itself — it may be an
  email). **Accepted risk, stated:** NO family-verification gate, mirroring
  sit — an authenticated unverified parent can resolve display fields two
  characters at a time; the payload is display-only (no contact fields, no
  aboutMe), `sendTutorContactRequest` (the only next step) enforces
  `isFullyVerified` itself, and the audit entry makes scraping visible.
  The wire type `TutorLookupResult` lives once in `@ejm/study-core`.
- `TutorLookup` component on the family SearchPage (below the subject
  search; study has no preferred-tutors page by decision C.Q2=a, so the
  lookup lives on the search surface): debounced 400ms input, compact result
  rows, per-status CTA (send dialog / pending chip / incoming link to
  /family/requests / connected chip). The send dialog SELECTS subject+level
  from the tutor's offered list (unlike TutorCard, there is no matched
  subject to inherit) and posts through the ordinary
  `sendTutorContactRequest` flow.

**Throttle (round 2):** per-uid lookup budget (60/h, `registerLookup` --
the email-send counter shape, exact under concurrency, doc id prefixed
`lookup:` to avoid colliding with the bypass budget). The surface is
deliberately reachable by unverified families, so the throttle -- not a
verification gate -- is what makes scraping expensive; the audit entry
makes it visible. Dedicated client copy for resource-exhausted.

**Tests:** 18 integration pins (gates incl. enrollmentComplete, match
modes, status mapping incl. incoming/declined + latest-wins, cap,
no-contact-fields, named unverified-family accepted-risk pin, audit entry,
throttle spent/expired-window) + 12 component pins (debounce incl. the
no-call and stuck-spinner transitions, out-of-order stale-response
discard, rows, status rendering, chosen-subject payload, error copy per
code incl. verification and throttle).
