# Guardian Foundation (Parental Governance PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The guardian data model and full link lifecycle: parent-created kid invites (silent three-way branching, 7-day tokens, cancel/resend), invite redemption creating supervised accounts with immutable parent-attested identity, claim confirm/decline for existing minors, age-checked revocation, identity correction, governed-account integration with the PR 1 age gates, and GDPR delete/export coverage.

**Architecture:** All guardian callables live in `packages/shared-functions/src/guardian/` and are re-exported from `apps/functions/src/index.ts` (the established shared-callable pattern — one Firebase project, callables are project-global, both web apps can call them). Two new collections (`kidInvites`, `guardianLinks/{childUid}`) plus an `adminAlerts` collection; the child's user doc carries server-owned mirrors `governedBy` + `identityLocked` (rules-pinned). Read the approved master design FIRST: `docs/superpowers/plans/2026-08-04-parental-governance-design.md` — its rulings are binding; this plan operationalizes them.

**Anti-enumeration invariant (binding):** `createKidInvite` returns an identical `{ success: true }` in EVERY branch (no account / unsupervised account / supervised-elsewhere / duplicate). Any response or error difference that reveals account existence is a defect. The ONLY user-visible rejections are: caller not a family parent, invalid EJM email format/grad-year, missing/stale consent versions — none of which depend on the kid's account state.

---

## Data shapes (authoritative for this PR)

```ts
// kidInvites/{inviteId} — auto id
{
  kidEmailLower: string;          // validated EJM email, lowercased
  firstName: string; lastName: string;
  dateOfBirth: string;            // "YYYY-MM-DD" parent-entered
  familyId: string; createdByParentUid: string;
  tokenHash: string;              // sha256 hex of the raw emailed token; raw token NEVER stored
  status: 'pending'|'accepted'|'cancelled'|'expired';
  createdAt; expiresAt;           // 7 days
  resentAt?;
  consent: { tosVersion: string; privacyVersion: string;
             supervisionAgreementVersion: string; approvedAt; approvedByUid: string };
}

// guardianLinks/{childUid} — doc id IS the child uid (one supervising family per child)
{
  childUid: string; familyId: string; createdByParentUid: string;
  status: 'pending'|'active'|'revoked';
  origin: 'parent_created'|'claim';
  requestedAt; confirmedAt?; revokedAt?; revokedByUid?;
  consent: { ...same shape as above };   // the GDPR consent record
}

// adminAlerts/{alertId} — auto id
{ type: 'guardian_conflicting_claim'; createdAt;
  data: { attemptedByUid: string; familyId: string; kidEmailLower: string;
          existingLinkFamilyId: string }; }

// users/{childUid} additions (server-owned):
governedBy?: { familyId: string; linkedAt };   // present iff link ACTIVE
identityLocked?: true;                          // parent-created accounts only, permanent
```

Constants (shared-core `constants/config.ts`): `SUPERVISION_AGREEMENT_VERSION = '1.0'`, `KID_INVITE_VALIDITY_DAYS = 7`. Callers must send consent versions EQUAL to the current constants (ToS/privacy current versions: find the existing consentVersion source the enrollment flows use and reuse it; stale versions → invalid-argument).

New shared-core helper: export `ageFromDob(dateOfBirth: Date, now?: Date): number` from `agePolicy.ts` (extract the existing internal `fullYears` — refactor, don't duplicate; keep existing tests green).

## Task 1: types, constants, rules, rules tests

- shared-core: `GuardianLink`, `KidInvite`, `GuardianConsent` types (types/guardian.ts, exported); constants above; `ageFromDob` export.
- `firestore.rules`:
  - `kidInvites`: `allow read: if isFamilyMember(resource.data.familyId) || isAdmin(); allow write: if false;`
  - `guardianLinks`: `allow read: if isAuth() && (request.auth.uid == resource.data.childUid || isFamilyMember(resource.data.familyId) || isAdmin()); allow write: if false;`
  - `adminAlerts`: admin read, no writes.
  - users update rule: add `'governedBy', 'identityLocked'` to the top-level `hasAny([...])` immutable list, AND a new `identityUnlockedOrUnchanged()` guard: when `resource.data.get('identityLocked', false) == true`, `firstName`, `lastName`, `dateOfBirth` must be unchanged.
- Rules tests: each collection's read matrix (child/family-parent/other-family-parent/stranger/admin), write denial, users pins (client cannot set/clear governedBy or identityLocked; locked account cannot change firstName/lastName/dateOfBirth but CAN still edit e.g. photoUrl; unlocked account still can change its name — regression guard).
- Commit: `feat(shared-core,rules): guardian link data model and identity-lock pins`

## Task 2: createKidInvite (+ cancel/resend)

`packages/shared-functions/src/guardian/createKidInvite.ts`, `manageKidInvite.ts`.

createKidInvite({ kidEmail, firstName, lastName, dateOfBirth, consent: {tosVersion, privacyVersion, supervisionAgreementVersion} }):
1. Auth → caller users doc → `getParentProfile` → familyId (else permission-denied 'guardian/not-a-family-parent').
2. zod: names 1–80 trimmed; dateOfBirth YYYY-MM-DD real date; consent versions must EQUAL current constants (invalid-argument on stale/missing). `validateEjmEmail(kidEmail)` — invalid → invalid-argument (safe to show).
3. Branch on account state (admin SDK; all outcomes return `{ success: true }`):
   - Look up `users` where `email == kidEmailLower` (limit 1).
   - **No account:** dedup (existing pending invite same kidEmailLower+familyId → treat as resend: new token, reset expiry, re-send email, done). Else create kidInvites doc + email the kid a link containing the RAW token (`https://sync-sit.web.app/kid-invite?token=…` — page built in PR 5; store sha256 hash only).
   - **Account exists, guardianLinks/{uid} absent or status revoked:** upsert guardianLinks doc `{status:'pending', origin:'claim', consent, requestedAt}` keyed by child uid (idempotent if already pending for the SAME family: refresh requestedAt). In-app notification + push to the kid ("A parent asked to supervise your account") — NOT email-revealing to the parent. Parent-entered name/DOB are NOT applied to the existing account; if they materially mismatch the account's stored identity (ageFromDob differs by >1y or names differ case-insensitively), ALSO write an adminAlert (type 'guardian_claim_identity_mismatch') — quiet, parent response unchanged.
   - **Account exists, link pending/active with a DIFFERENT familyId:** write adminAlert 'guardian_conflicting_claim'; create NOTHING else.
   - **Same family already active:** no-op success.
4. `writeUserActivity` audit in every branch (branch recorded in details — the AUDIT may know what the parent must not).

cancelKidInvite({ inviteId }) / resendKidInvite({ inviteId }): caller must be family parent of invite.familyId; only `pending` invites; cancel → status cancelled; resend → NEW token, expiresAt = now+7d, resentAt, re-send email. Expired-at-read: a pending invite past expiresAt is treated as expired everywhere (redeem rejects; resend UN-expires it by design — resend is the recovery path).

Integration tests (red-first): family-parent gate; consent-version stale rejected; invalid email rejected; no-account → invite doc + email fields correct + token hash matches emailed token (capture via emulator email stub — follow how existing tests assert sendNotificationEmail, or assert doc shape + notification write); dedup-resend path; claim path creates pending link + kid notification, response IDENTICAL to invite response (assert deep-equal of both callable results); identity-mismatch claim writes the quiet alert; conflicting-family → adminAlert only, NO link/invite created, response still identical; same-family-active no-op; cancel/resend lifecycle + auth matrix.
- Commit: `feat(shared-functions): createKidInvite with silent branching, cancel and resend`

## Task 3: redeemKidInvite

Unauthenticated callable ({ token, password }):
1. sha256(token) → query kidInvites by tokenHash (equality; limit 1). Missing → not-found 'guardian/invalid-invite' (generic). status must be pending; past expiresAt → mark expired + same generic error.
2. Password: `strongPasswordSchema`.
3. If an Auth user already exists for kidEmailLower (kid self-enrolled in the window) → mark invite cancelled + generic error (no info leak beyond what the kid already knows).
4. Create: Auth user (email+password, displayName firstName) → users doc with invite identity (email, firstName, lastName, dateOfBirth as Timestamp, status 'active', language default, notifPrefs default, profiles: {}, consentAt/consentVersion from invite tos, `identityLocked: true`, `governedBy: { familyId, linkedAt: now }`) → guardianLinks/{uid} `{status:'active', origin:'parent_created', consent: invite.consent, requestedAt: invite.createdAt, confirmedAt: now}` → invite status accepted. Mirror the account-creation idiom of enrollBabysitter/enrollTutor's new-account paths (custom-token return value etc. — match whatever the enrollment callables return so the client can sign in; verify and follow).
5. notifyAllParents(familyId, …) "«kid» accepted the invitation"; audit.

Tests: happy path (all three docs + auth user + identityLocked + governedBy asserted via REST); wrong/expired/cancelled/reused token → same generic error shape; expiry marks doc; account-exists race; weak password; invite consent copied verbatim onto link.
- Commit: `feat(shared-functions): redeemKidInvite creates supervised accounts`

## Task 4: respondToSupervisionRequest + revokeSupervision + correctChildIdentity

- respondToSupervisionRequest({ accept }): kid auth; guardianLinks/{uid} must be pending origin 'claim'. Accept → status active, confirmedAt, `governedBy` mirror set on own user doc (server), notifyAllParents. Decline → DELETE the link doc (parent sees nothing; a later re-ask is allowed). Tests incl.: parent_created pending links are NOT respondable by this callable (they only activate via redeem).
- revokeSupervision({ childUid }): caller = family parent of the ACTIVE link's familyId, or admin. Child's `ageFromDob` must be ≥15 → else failed-precondition 'guardian/child-under-15' (admin is ALSO bound — the design gives admin force-revoke, but under-15 force-revoke pairs with account deactivation, which is PR 3 scope; here admin gets the same refusal, documented). On success: link status revoked + revokedAt/ByUid; DELETE `governedBy` mirror (FieldValue.delete); `identityLocked` STAYS (identity remains parent-attested); notifyAllParents + kid notification; audit.
- correctChildIdentity({ childUid, firstName?, lastName?, dateOfBirth? }): caller = family parent of ACTIVE link or admin; target must be identityLocked; at least one field; zod as Task 2; updates user doc (dateOfBirth → Timestamp); audit records before/after. Tests: kid self-call denied; non-link parent denied; revoked link denied (admin still allowed); DOB correction reflected in ageFromDob-dependent behavior (revoke gate).
- Commit: `feat(shared-functions): supervision respond, revoke, and identity correction`

## Task 5: age-gate integration (the PR 1 ↔ governed interplay)

- `enrollTutor`: on the ADD-PROFILE path (request.auth present), read the caller's user doc: if `governedBy` present → SKIP the whole age gate (floor and consistency — DOB is parent-attested). New-account path keeps the full gate (a governed kid always has an account). Tests: governed 13-year-old (redeemed account) add-profile enrolls successfully; ungoverned 13-year-old still rejected; governed account with revoked link (no governedBy) rejected again.
- `searchBabysitters` backstop: do NOT exclude a candidate whose user doc has `governedBy` (check what the search view exposes — if `getBabysitterView` strips top-level governedBy, read it off the raw doc data already in hand). Tests: governed under-15 babysitter VISIBLE; ungoverned under-15 still hidden.
- Commit: `feat(functions,study-functions): governed accounts bypass the self-enrollment age gate`

## Task 6: GDPR integration

In `packages/shared-functions/src/admin/`:
- `deleteUser(child)`: also delete guardianLinks/{uid} and any kidInvites with kidEmailLower == their email.
- `deleteUser(parent)`: if the deleted parent was the LAST parent in their family (inspect families/{id}.parentIds after removal — follow the existing family-cleanup logic in deleteUser/removeCoParent): for each ACTIVE guardianLink of that family → if child ageFromDob < 15: set child user status per the existing deactivateUser semantics + adminAlert 'guardian_orphaned_minor'; all links → status revoked + governedBy mirror removed. Children ≥15 just lose supervision (link revoked, account untouched).
- `exportUserData`: include guardianLinks where childUid == uid; links where familyId == the user's family; kidInvites created by them (createdByParentUid) or addressed to their email.
Tests: each path via REST ground truth; last-parent-with-minor deactivation + alert; co-parent-remains case does NOT touch links.
- Commit: `feat(shared-functions): guardian links in delete and export flows`

## Task 7: gates

Full monorepo gates (typecheck, build, all unit suites, FULL emulator integration + rules suite), confirm no index additions needed (all new queries are single-field equality). Update apps/functions/src/index.ts exports (all six new callables). Completion report.

## Self-review notes

- The response-identity assertion (Task 2) is the security test of this PR — deep-equal the callable results across branches.
- guardianLinks doc id = childUid gives idempotency and the one-family invariant structurally.
- `governedBy` present ⇔ link ACTIVE, everywhere (pending claim does NOT set the mirror).
- Raw invite tokens exist only in email; docs store hashes; resend rotates.
- No composite indexes: verify every new query is equality-on-one-field.
