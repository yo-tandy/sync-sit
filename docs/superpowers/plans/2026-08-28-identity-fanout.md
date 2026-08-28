# Identity-correction name fan-out (issue #273)

Both identity-correction callables (`correctUserIdentity` — admin, #158/#270;
`correctChildIdentity` — guardian, #146) update only `users/{uid}`, while root
identity is denormalized as display names into long-lived docs. This plan
records the fill-site inventory, the attribution decisions, and the fan-out
semantics.

## Inventory: persisted person-name denormalizations (verified on main @ 306769b)

| Collection | Field | Fill site(s) | Name-owner uid on the doc? |
|---|---|---|---|
| `study-sessions` | `tutorName` | `bookSession` (both shapes), `proposeSession` | YES — `tutorUserId` (always) |
| `study-sessions` | `parentName` | `bookSession` (both shapes) | Indirect — `createdByUserId` is the booking parent |
| `study-sessions` | `parentName` | `respondToSession` provider-proposal confirm (`providerConfirmDenorm`) | **NO** — the confirming parent's uid was never stored → new `parentUserId` |
| `studyContactRequests` | `tutorName` | `sendTutorContactRequest`, `sendFamilyContactRequest` | YES — `tutorUserId` (always) |
| `studyContactRequests` | `parentName` | `sendTutorContactRequest` | Indirect — `createdByUserId` is the sending parent |
| `studyContactRequests` | `parentName` | `respondToFamilyContactRequest` accept (fills the `''` minted by `sendFamilyContactRequest`) | **NO** → new `parentUserId` |
| `contactSharingRequests` (sit) | `parentName` | `addPreferredBabysitter` (note: sit format uppercases the last name) | **NO** — only `familyId`/`babysitterUserId` → new `parentUserId` |
| `references` | `submittedByName` | `submitTutorEndorsement` (study; the submitting parent's ACCOUNT name) | YES — `submittedByUserId` |

Swept and confirmed OUT of scope:

- **sit `appointments`**: persist `familyName` (family display name, not root
  user identity) and kid `{age, languages}` — no person names.
  `babysitterName`/`sitterName`/`parentName` in `respondToRequest`,
  `contactPublishedSearch`, `submitVerification`, reminders, etc. flow only
  into notifications/emails (ephemeral).
- **sit `references`** (`submitFamilyEndorsement`): `submittedByName` is set to
  the free-text `refName`, NOT the submitter's account identity — it must NOT
  be rewritten. These docs carry no `appSource`; study endorsements carry
  `appSource: 'study'`, which is the sweep filter.
- **`students[].firstName` on study-sessions**: snapshots of
  `families/{id}/kids` subcollection docs, not `users` — kid-roster identity
  is outside both correction callables (they correct `users/{uid}` only).
- **Auth record `displayName`** (set at enrollment): also stale after a
  correction, but pre-existing and out of #273's Firestore-denormalization
  scope; neither callable touched it before and none of the swept UIs read it.
- **admin read-paths** (`listAppointments`, `listAuditLogs`,
  `listPendingVerifications`): resolve names at read time — self-healing.

## Decisions

1. **New field `parentUserId`** (uid of the person whose name is in
   `parentName`) written at every parentName fill site from now on:
   `bookSession` (both doc shapes), `sendTutorContactRequest`,
   `respondToSession` provider-confirm, `respondToFamilyContactRequest`
   accept, `addPreferredBabysitter`. On `bookSession`/`sendTutorContactRequest`
   it duplicates `createdByUserId`, but makes attribution uniform and
   respond-time-proof. `proposeSession`/`sendFamilyContactRequest` leave it
   absent alongside their `parentName: ''` (filled at confirm/accept).
2. **Shared fan-out helper** `packages/shared-functions/src/identity/nameFanOut.ts`,
   called by BOTH callables after the `users/{uid}` update commits, only when
   `firstName`/`lastName` changed (a DOB-only correction fans out nothing).
   Per-sweep bounded pagination (`limit(300)` + `startAfter`) with one batched
   write per page (≤300 ops, under the 500 cap).
3. **Sweeps** (all equality-only queries — served by auto single-field indexes,
   the two-field references query by zig-zag merge; no composite index needed):
   - `study-sessions` / `studyContactRequests`: `tutorName` where
     `tutorUserId == uid`; `parentName` where `parentUserId == uid`; plus a
     LEGACY sweep `createdByUserId == uid` guarded in code by
     `!parentUserId && tutorUserId !== uid` — this reaches every pre-#273
     parent-CREATED doc (the issue's "attributable" cases) without a backfill.
   - `contactSharingRequests`: `parentName` where `parentUserId == uid`
     (sit name format: `First LASTUPPER`). Legacy docs are unreachable
     (only `familyId` stored) — accepted, per issue option 1.
   - `references`: `submittedByName` where `submittedByUserId == uid` AND
     `appSource == 'study'` (sit endorsements store free-text refName there).
   - Unreachable-by-design remainder: pre-#273 respond/confirm-filled
     `parentName` (study-sessions provider confirms, tutor-initiated
     studyContactRequests) and all pre-#273 `contactSharingRequests`. No
     backfill script (per scope decision — not trivial: the confirm-time uid
     is not recoverable from the doc).
4. **Error semantics**: the root `users` update is the source of truth and
   commits FIRST; each sweep runs independently in try/catch — one
   collection's failure neither aborts the correction nor the remaining
   sweeps. The audit entry (`details.fanOut`) records per-collection updated
   counts (`{updated: {collection: {field: n}}, errors: [message...]}`), so a
   partial fan-out is visible in the audit trail. The callable response shape
   is unchanged.
5. **updatedAt** is bumped on every fanned-out doc (repo convention; both
   session lists sort by `createdAt`, so no reordering side effects).

## Tests

`tests/integration/admin/identity-name-fanout.test.ts` (lane-parameterized like
the existing suites): seeded docs per collection; correct a name via
`correctUserIdentity` → copies follow (incl. the sit uppercase format and the
legacy `createdByUserId` sweep); docs WITHOUT owner attribution stay untouched
(contactSharingRequests sans `parentUserId`; a confirmed provider-proposal doc
sans `parentUserId`; a sit-shaped reference sans `appSource`); DOB-only
correction fans out nothing; the audit entry carries the fanOut summary;
`correctChildIdentity` fans out a governed tutor-kid's `tutorName`. Fill-site
pins added to the existing `book-session` / `send-tutor-contact-request` /
`family-contact-inversion` / `respond-to-proposal` / `add-preferred-babysitter`
suites assert `parentUserId` is now written. Mutation-verify: disable the
fan-out call, watch the copy-follows pin fail, restore.
