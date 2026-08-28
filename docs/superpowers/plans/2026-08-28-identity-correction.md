# Admin identity-correction path for set-once root identity (issue #158)

## Goal

Root identity (`firstName` / `lastName` / `dateOfBirth`) is set-once for every
account (issue #144): `rootIdentitySetOnce()` in firestore.rules freezes a
populated value against ALL client writes, and `identityUnlockedOrUnchanged()`
additionally freezes the trio on `identityLocked` accounts. The existing
`correctChildIdentity` callable refuses unless `identityLocked === true` —
but claim-origin governed accounts never get `identityLocked` (see the note
in `packages/shared-functions/src/guardian/createKidInvite.ts`: "existing
accounts never get identityLocked"), and self-managed accounts were left with
no correction path at all (the deliberate gap called out in the
`identityFieldSettable` comment block in firestore.rules).

Close the gap with an admin-only `correctUserIdentity` callable plus a small
admin-UI dialog: admin-gated, audited, writes only the provided root fields.

## Why this does not undermine #146's set-once invariant

The invariant #144/#146 established is that **clients** can never mutate a
populated root-identity field — cross-app enrollment must never clobber
identity set by the other app, and a governed kid must not rewrite
parent-attested identity. The rules only bind client SDK writes; callables
run on the Admin SDK and were always the designed escape hatch — the rules
comments say so explicitly ("corrections go through the correctChildIdentity
callable or admin", "admins intervene directly when a real correction is
needed" in correctChildIdentity itself). `correctUserIdentity` is that
documented escape hatch made real: gated by `verifyAdmin` (the same gate as
`blockUser`), every change audited with before/after values, and scoped to
exactly the three root fields. Client-side enforcement is untouched — the
rules tests keep pinning that a client (owner, governed kid, or even an
admin using the client SDK) is still denied.

## Denormalized copies of root identity (grep audit)

Checked everywhere `firstName`/`lastName` is copied out of a users doc
(`grep -rn firstName` over `packages/shared-functions/src`,
`apps/functions/src`, `apps/study-functions/src`):

**Live reads (unaffected by a correction):** search results
(`searchBabysitters`, `searchTutors`, `lookupBabysitter`, `lookupTutor`),
admin listings (`listUsers`, `listFamilies`, `listAuditLogs`,
`listPendingVerifications`), contact payloads (`getParentContacts`) and
oversight views (`getGovernedChildDetail`) read the users doc at call time.
Sit appointment docs carry `familyName`, not user names; the names in sit
appointment/search flows (`sitterName`, `babysitterName`) are interpolated
into one-shot notification/email bodies, not stored.

**Persisted copies (STALE after a correction — known limitation, #273):**

- `study-sessions` docs store `tutorName` (bookSession, proposeSession) and
  `parentName` (bookSession; respondToSession fills it on provider-proposal
  confirm). Study surfaces deliberately render the stored copy — e.g. the
  family RequestsPage renders `tutorName` because parents cannot read the
  tutor's user doc under the rules — and `cancelSession` notifications reuse
  `session.tutorName`.
- `studyContactRequests` docs store BOTH `parentName` and `tutorName`
  (sendTutorContactRequest; the tutor-initiated sendFamilyContactRequest
  stores `tutorName` and fills `parentName` at respond).
- `contactSharingRequests` docs store `parentName`
  (addPreferredBabysitter; note it uppercases the last name).

Neither correction path refreshes these: `correctChildIdentity` has had the
same gap since #146, and this callable mirrors it. Attribution for a
fan-out is mixed: `tutorName` is always attributable via `tutorUserId`
(sessions and both contact-request collections), and `studyContactRequests`
also records the parent-initiated caller (`createdByUserId`) — but
`parentName`'s owner uid is missing where the name arrives on a respond/
confirm step (study-sessions provider-proposal confirm, tutor-initiated
studyContactRequests) and in `contactSharingRequests`, which records only
`familyId` (a family can hold several parents). Follow-up issue #273
tracks recording the name-owner uid where it is missing and fanning out
from BOTH correction callables.

**Other derived copies:**

- Study session `students: {firstName, age}` come from the family `kids`
  subcollection (parent-entered kid records), not users-doc root identity.
  Unaffected.
- **Firebase Auth `displayName`** is derived from firstName/lastName at
  account creation (`enrollFamily`, `joinFamily`, `redeemKidInvite`,
  `enrollBabysitter`). `correctChildIdentity` deliberately does not sync it
  (nothing user-facing reads it back; the apps render Firestore names), so
  `correctUserIdentity` mirrors that and leaves it alone too.

Conclusion: mirror `correctChildIdentity` exactly — write the users doc, no
fan-out — with the study-side display-name staleness documented above and
tracked in #273.

## Changes

1. `packages/shared-functions/src/admin/correctUserIdentity.ts` — new
   callable, mirroring the `blockUser` idiom (onCall europe-west1 + cors,
   auth check, `verifyAdmin`, `writeAuditLog`):
   - Input `{ targetUserId, firstName?, lastName?, dateOfBirth? }` validated
     with a zod `.strict()` object built from the same `kidIdentitySchema`
     (`@ejm/shared-core`) that `correctChildIdentity` uses — non-empty
     trimmed names max 80, DOB `YYYY-MM-DD` that parses to a real calendar
     date; unknown fields rejected; at least one identity field required.
   - Read the target users doc; `not-found` if missing.
   - Update ONLY the provided fields (+ `updatedAt`), DOB stored as a
     `Timestamp` at `T00:00:00Z` — same serialization as
     `correctChildIdentity`. Never touches `profiles.*`, `status`, or
     anything else.
   - Audit entry `user_identity_corrected` with per-field before/after and
     `targetUserId` (before-DOB serialized back to `YYYY-MM-DD`, same as
     correctChildIdentity).
   - No `identityLocked` / `governedBy` precondition: this is precisely the
     path for accounts the guardian callable refuses (claim-origin governed
     kids and self-managed accounts).
2. Registration: export from `packages/shared-functions/src/admin/index.ts`;
   `apps/functions/src/admin/correctUserIdentity.ts` re-export +
   `apps/functions/src/index.ts` — sit-only, exactly like `blockUser` (the
   admin panel lives in apps/web; study-functions registers no admin
   callables).
3. Admin UI (`apps/web`):
   - `adminStore`: `correctUserIdentity(payload)` action via `httpsCallable`
     (omit-empty fields, like `fetchFamilies` does); `AdminUserListItem`
     gains `dateOfBirth?: WireTimestamp | null` (listUsers already spreads
     the whole doc onto the wire).
   - `UsersPage`: a "Correct identity" action button per row opening a
     dedicated small Dialog (the confirm-dialog idiom extended with inputs):
     three `Input`s prefilled with current values (DOB via
     `wireTimestampToMillis` → `YYYY-MM-DD`), save sends only the fields
     that changed, disabled while saving or when nothing changed, then
     reloads the list.
   - i18n en + fr in the `admin` section.
4. Tests:
   - `tests/integration/admin/correct-user-identity.test.ts` — admin
     corrects each field / all fields; partial update leaves other fields
     untouched (incl. `profiles.*` and `status`); a governed claim-origin
     kid (governedBy set, NO identityLocked — the account
     `correctChildIdentity` refuses) IS correctable; audit before/after;
     unauthenticated / non-admin denied; not-found; validation matrix
     (no fields, empty/whitespace name, name >80, bad DOB format, impossible
     date, unknown field rejected).
   - `tests/rules/firestore-rules.test.ts` — existing pins already cover the
     client-side denials (unlocked owner, governed-without-lock owner); add
     one pin that an ADMIN on the **client** SDK cannot write another user's
     `firstName` (users update is owner-only), so the callable is provably
     the only admin path.
   - `apps/web` component test: dialog opens prefilled, save calls the
     callable with only changed fields, list reloads.
