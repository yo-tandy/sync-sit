# Shared identity fields: root-canonical ejemEmail + contact (2026-08-19)

Owner decisions (issue #203 report, PR #205 comment): the EJM email must not
exist as a per-app field, and contact information is shared between the apps.
This plan makes `ejemEmail`, `contactEmail`, `contactPhone`, `whatsapp`
canonical at the ROOT of users/{uid}, with the existing nested copies
(`profiles.babysitter.*`, `profiles.tutor.*`) retained for back-compat readers
until a later cleanup.

## Data model

Root users/{uid} gains four optional fields:

- `ejemEmail: string` — verified EJM identity. Server-owned, client-immutable
  (same semantics as the nested copies: only enrollment callables write it).
- `contactEmail`, `contactPhone`, `whatsapp: string | null` — owner-editable
  contact channels, shared across apps.

Nested copies stay and keep being written by SERVER enrollment writers
(dual-write) so every existing reader keeps working; client Account pages stop
writing nested contact and write ROOT ONLY. Reads everywhere become
root-first with nested fallback, so merge order against in-flight branches
(PR #205) and un-backfilled docs never matters.

## Read helpers (packages/shared-core)

`types/userAdapter.ts`:

- `getEjemEmail(user): string | undefined` — root `ejemEmail` ?? nested
  babysitter ?? nested tutor (empty string treated as absent at every level).
- `getContact(user): { contactEmail, contactPhone, whatsapp }` — PER-FIELD
  root ?? nested(babysitter) ?? nested(tutor) fallback ('' and null are
  "absent" for fallback purposes; the resolved value is string | null).
  Per-field because a user can hold root contactEmail (post-change edit) next
  to nested-only contactPhone (pre-change enrollment).
- `hasAnyContact(user): boolean` — any of the three resolved fields non-empty.

Root field typing joins `User` in `types/user.ts`.

## Writers

Server (dual-write root + nested; Admin SDK bypasses rules):

- `enrollBabysitter` (apps/functions)
  - new-account: users.set() adds root `ejemEmail` (contact is not collected
    at creation on sit — nothing to dual-write).
  - add-profile (classic + crossApp): `fillBaseFields` gains `ejemEmail` and
    the three contact fields (from the crossApp copy when present).
    fillBaseFields only fills EMPTY root fields — an existing root value wins,
    matching set-once semantics.
  - crossApp derivation: EJM email = root ?? nested tutor (was nested-only);
    the copied contact fields resolve via getContact (root ?? nested).
- `enrollTutor` (apps/study-functions)
  - new-account: users.set() adds root `ejemEmail` + root contact (tutor
    enrollment does collect contact).
  - add-profile (classic + crossApp): `fillBaseFields` gains `ejemEmail` +
    contact from the validated enrollment payload.
  - crossApp derivation: EJM email = root ?? nested babysitter; copied
    contact resolves via getContact.

Client:

- sit babysitter AccountPage: contact save writes ROOT ONLY
  (`contactEmail/contactPhone/whatsapp` top-level); state initializes from
  getContact fallback; ejemEmail display uses getEjemEmail.
- study tutor AccountPage: same.
- sit StepPreferences (enrollment contact step): dual-writes root + nested —
  it IS an enrollment writer, merely client-side; root-only here would leave
  new sit enrollees canonical-empty and nested-only here would keep minting
  the debt this plan retires. (Deliberate deviation from "Account pages
  root-only"; flagged in the report.)

## Readers moved to helpers

- `lookupBabysitter` (email match) → getEjemEmail(raw doc)
- `searchBabysitters` age-gate + exemption key → getEjemEmail(raw doc)
- `searchBabysitters` contact projection to approved families → getContact
- `searchTutors` contact projection to approved families → getContact
- `respondToTutorContactRequest` contact email body → getContact
- `enrollTutor` / `enrollBabysitter` crossApp derivations → root ?? nested
- sit AccountPage + study AccountPage displays → helpers
- study `canCrossAppEnrollTutor` contact predicate → hasAnyContact
  (its base-version predicate reads nested contact; PR #205 rewrites this
  file — at merge, #205's ejemEmail read should switch to getEjemEmail; noted
  in the report as the one real conflict surface)

Deliberately left nested-only (with reason):

- `getParentContacts` + parent enrollment: `profiles.parent.phone/whatsapp`
  are the PARENT's contact — a different field family, out of scope.
- Family-facing client cards (TutorCard, ExpandableBabysitterCard, search
  pages): they render CALLABLE projections, not user docs — fixed at the
  projection site, no client change needed.
- `copySharedProfileFields` classLevel/gender: profile-scoped, not part of
  the shared-identity set.

## firestore.rules (minimal)

1. Root `ejemEmail` becomes client-immutable exactly like `uid`/`email`: add
   `'ejemEmail'` to the owner-update forbidden `affectedKeys` list. This is
   the same semantics as the nested pins (a client can never set OR change
   it — only enrollment callables write it, and the backfill runs Admin SDK).
2. Root contact fields: NO change. Verified: the forbidden list
   (`uid,email,status,createdAt,isAdmin,governedBy,identityLocked,
   sessionEpoch`) does not include them and no other root guard
   (rootIdentitySetOnce covers only firstName/lastName/dateOfBirth) touches
   them, so they are already owner-writable.

## Backfill

`scripts/backfill-shared-identity.cjs` — idempotent, DRY-RUN default,
`--apply` to write (env APPLY=1 also honored, matching the postcode script).
For each users doc: for each of the four fields, if the root key is ABSENT
and a nested copy holds a non-empty string, copy nested → root. An explicit
root null is a user CLEAR and is never lifted over; non-string nested junk is
skipped, matching what getContact resolves. When
babysitter and tutor copies BOTH exist and disagree, the babysitter copy wins
(sit predates study; sit-origin values are the older, first-verified ones).
Root-populated fields are never touched, so re-running is a no-op.

## Tests

Unit:
- shared-core: getEjemEmail/getContact/hasAnyContact fallback order, empty
  handling, per-field mixing.
- sit + study AccountPage: contact save writes root-only paths (no
  `profiles.*.contact*` keys in the updateDoc payload); state seeds from root
  when present, nested when not.
- study postLoginRouter: contact predicate satisfied by root-only contact.

Integration (lane 2 — written here, run by the lead):
- enroll-babysitter: new-account writes root ejemEmail; crossApp add-profile
  fills root ejemEmail + contact from the tutor copy; root values already
  present are not clobbered.
- cross-app-enroll-tutor: crossApp derives from ROOT ejemEmail when the
  nested babysitter copy is absent (and still from nested when only nested
  exists); new-account tutor writes root ejemEmail + contact.
- rules (stripped-copy idiom in tests/rules/): owner update touching root
  ejemEmail denied (set AND change); owner update of root contact fields
  allowed; non-owner update denied.

## Gates

study-web + web full test/lint/build; shared-core, shared-functions (if
touched), study-functions, functions tests + builds. Baselines discovered
fresh at 7541f8a.

## Deliberately left (PR #206 review)

- `lookupBabysitter` now matches on the ROOT ejemEmail (via `getEjemEmail`),
  which can diverge from `profiles.babysitter.ejemEmail` for the (likely
  unreachable) user who verified TWO different EJM addresses across the two
  apps: `fillBaseFields` never overwrites a populated root, so a later classic
  babysitter enrollment with address A leaves root at the earlier tutor
  address B. Family lookup and the searchBabysitters age-gate then key off B.
  Accepted: one canonical identity per account is the point of this change;
  the backfill's CONTESTED output surfaces any real-world instance.

- The same divergence silently REKEYS the age-gate exemption lookup
  (`searchBabysitters.ts`, `enrollmentExemptions/{email}`). Those docs are
  keyed on whatever address an admin typed, read off the babysitter's profile,
  while the lookup now uses the root `ejemEmail` — so for a two-address
  account an exemption granted on the nested address is ignored and the
  babysitter drops out of family search results with no signal to anyone
  (PR #206 review). Same accepted trade and same detection path as above (the
  backfill flags the doc CONTESTED); recorded here so the next person
  debugging a vanished babysitter has the thread.
