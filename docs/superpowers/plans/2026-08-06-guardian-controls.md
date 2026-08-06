# Guardian Controls (Parental Governance PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give supervising families their powers: oversight reads (multi-kid dashboard + full per-kid detail including ALL notes), protective controls (hide from search, cancel, decline), notification mirroring, and the admin governance surfaces (supervised-accounts listing, alerts, force-revoke with under-15 deactivation pairing).

**Architecture (three deliberate choices):**
1. **Protective controls are AUTH EXTENSIONS of the existing lifecycle callables, not new wrappers.** cancelSession/cancelSessionInstance/respondToSession (study), cancelAppointment/respondToRequest/respondToContactSharing (sit), respondToTutorContactRequest (study) each gain a third caller resolution: an authenticated user who is a parent in the ACTIVE `guardianLinks/{providerUid}.familyId` family acts ON THE PROVIDER'S SIDE. Resolution order: provider themself → session/appointment family parent → guardian (document in each callable). Guardian actions are **decline/cancel only** — a guardian can NEVER accept/confirm on the kid's behalf (consent principle: the kid runs their own flow; the guardian protects). This reuses every existing transaction, status, ledger-restore, and notification path; the guardian identity is recorded in the audit (`actorRole: 'guardian'`, actor uid) and the kid is notified of guardian actions.
2. **Notification mirroring is ONE Firestore trigger** (`onDocumentCreated('notifications/{id}')`, sit codebase, following `onReferenceCreated`'s idiom): when the recipient's user doc carries `governedBy`, fan the notification out to every parent of that family (in-app copy with `type: 'guardian_mirror'`, original type in data; email per each parent's own notifPrefs category mapping — reuse notifyAllParents if its shape fits, else mirror manually). SKIP mirroring when the notification type is already guardian-flow (`supervision_request`, `guardian_mirror`) to avoid loops/noise. Mirrors are copies — the kid's own notification is untouched.
3. **Oversight + admin callables live in `packages/shared-functions/src/guardian/`** (re-exported from apps/functions like PR 2's): they read across both apps' collections.

Read the master design first (`2026-08-04-parental-governance-design.md` — ruling 8: guardians see EVERYTHING incl. all notes/messages) and PR 2's plan for the data shapes.

---

## Task 1: oversight callables

`getGovernedChildren()`: caller → familyId (requireFamilyParent from PR 2's shared.ts). Query `guardianLinks` where familyId == caller's (equality, no index). For each link (any status — pending claims show as "awaiting the kid's confirmation"): child user summary (firstName/lastName/photoUrl/status/dateOfBirth→age via ageFromDob), link {status, origin, requestedAt/confirmedAt}, per-app profile presence + searchable flags, upcoming counts (next 30 days: sit appointments where babysitterUserId==child & confirmed & date>=today — verify sit's actual field names against the appointment collections; study confirmed sessions/instances). Pending kidInvites for the family are ALSO returned (so the dashboard shows un-redeemed invites with expiry) — invites and links in one payload.

`getGovernedChildDetail({ childUid })`: caller must be parent of the child's ACTIVE link family (pending → permission-denied — oversight starts at consent). Returns, per ruling 8 (everything): profile (both apps' provider profiles incl. subjects/rates or sit equivalents), schedule summary (weekly grid + override count), study sessions + instances (ALL statuses, WITH pre/postSessionNote, message, lateCancellation), sit appointments (with notes-equivalents), pending booking requests + contact requests BOTH apps (with messages), endorsements/references counts. Bound list sizes (e.g. last 90 days + all future) and state the bound in code comments. Callable-based read — NO rules changes.

Tests (red-first): non-parent denied; parent of a DIFFERENT family denied; pending-link detail denied but children-list shows the pending row; notes present in detail payload (pin — ruling 8); invites appear with expiresAt; multi-kid family returns multiple rows; revoked link excluded from detail, shown as revoked in list.
Commit: `feat(shared-functions): guardian oversight callables`

## Task 2: guardianSetChildSearchable

`guardianSetChildSearchable({ childUid, app: 'sit'|'study', searchable: boolean })`: caller = parent of ACTIVE link family; child must have the corresponding profile (`profiles.babysitter` / `profiles.tutor`) else failed-precondition; admin-SDK update of `profiles.<role>.searchable` + updatedAt; audit with actorRole guardian; notify the kid (in-app + push): "A parent {hid your profile from|made your profile visible in} search". Tests: auth matrix (kid self N/A, other family denied, pending link denied), both apps, missing-profile error, kid notification written, searchable actually flips (REST).
Commit: `feat(shared-functions): guardian searchable control`

## Task 3: guardian auth extension — study callables

Files: `apps/study-functions/src/sessions/{cancelSession,cancelSessionInstance,respondToSession}.ts`, `apps/study-functions/src/contact/respondToTutorContactRequest.ts` (locate exact file).

In each, extend the caller-resolution block: when the caller is neither the provider nor (where applicable) a session-family parent, load `guardianLinks/{providerUid}`; ACTIVE + caller in that family (families doc read) → proceed as the provider side with `actorRole: 'guardian'` threaded into the audit call and a kid-facing notification appended ("A parent of your family cancelled/declined …"). For respondToSession and respondToTutorContactRequest the guardian path is DECLINE-ONLY: an accept/confirm attempt via the guardian path throws permission-denied 'guardian/decline-only'. Keep the existing paths byte-for-byte in behavior (all existing tests must stay green untouched — that is the regression contract).

Tests (new file tests/integration/guardian/guardian-study-controls.test.ts): guardian cancels a confirmed one_time session (status flips, override restored, statusReason 'cancelled_by_tutor', family notified via the EXISTING path, kid notified of the guardian action, audit actorRole guardian); guardian cancels an instance; guardian declines a pending session request; guardian declines a pending contact request; guardian CANNOT confirm a session (decline-only pin); guardian CANNOT act with pending/revoked link; random parent still denied; lateCancellation snapshot semantics apply unchanged to guardian cancels (one in-window case).
Commit: `feat(study-functions): guardian protective controls on session lifecycle`

## Task 4: guardian auth extension — sit callables

Files: `apps/functions/src/appointments/{cancelAppointment,respondToRequest}.ts`, `apps/functions/src/family/respondToContactSharing.ts`. Same pattern, provider = babysitterUserId; respondToRequest and respondToContactSharing guardian paths decline-only. Preserve H3's ledger-restore behavior on guardian cancels (assert slots restored in the test — reuse existing test helpers).

Tests (guardian-sit-controls.test.ts): mirror Task 3's matrix for sit (cancel confirmed appointment w/ slot restoration, decline pending request, decline contact sharing, accept blocked, link-state matrix).
Commit: `feat(functions): guardian protective controls on appointment lifecycle`

## Task 5: notification mirroring trigger

`apps/functions/src/guardian/onNotificationCreated.ts` (sit codebase — triggers deploy once, notifications is one shared collection): recipient's user doc has `governedBy` → for each parent in `families/{familyId}.parentIds` (excluding the recipient, defensive): write in-app copy `{ recipientUserId: parentUid, type: 'guardian_mirror', title: '[<kid firstName>] ' + original title, body, data: { ...original.data, mirroredFrom: recipientUserId, originalType: original.type }, read: false, channels: ['push'], createdAt }` + push. Email: only when the ORIGINAL had email intent (`channels` includes 'email') and the parent's own notifPrefs allow that category — map original type→pref category conservatively; when unmappable, in-app+push only (comment why). Skip types: `supervision_request`, `guardian_mirror`. Idempotency: trigger retries → guard with a deterministic mirror doc id (`{originalId}_{parentUid}` via .doc(id).set) so retries overwrite, not duplicate.

Tests (guardian-mirroring.test.ts, trigger tests follow however onReferenceCreated is tested — if it has no emulator test, write one: create a notification doc for a governed kid, poll for the mirror docs): mirror created per parent with prefixed title + originalType; ungoverned recipient → no mirror; supervision_request not mirrored; mirror-of-mirror impossible (type skipped); deterministic id (create same doc twice → one mirror).
Commit: `feat(functions): guardian notification mirroring trigger`

## Task 6: admin surfaces

`listSupervisedAccounts()` (admin): all guardianLinks (any status) joined with child summary + family name + consent versions/dates — the GDPR audit view. `listAdminAlerts({ onlyUnreviewed? })` + `reviewAdminAlert({ alertId })` (adds reviewedAt/reviewedByUid — write via callable, rules stay no-client-writes). `forceRevokeSupervision({ childUid, reason })` (admin-only): ACTIVE link required; if child ageFromDob < 15 → PAIR with the PR 2 orphan semantics (child status 'blocked' + Auth disabled + adminAlert 'guardian_forced_revoke_minor') — the admin is consciously removing a minor's required supervision, so the account cannot remain live; if ≥15 → plain revoke. Both: link revoked, governedBy mirror removed, family + kid notified, audit with reason.

Tests: admin-only matrix on all four; force-revoke under-15 blocks the child + alert; ≥15 plain; reviewAdminAlert stamps; listSupervisedAccounts includes consent record fields (pin — this is the GDPR view).
Commit: `feat(shared-functions): guardian admin surfaces and force revocation`

## Task 7: gates

Exports added to apps/functions/src/index.ts (oversight ×2, searchable, admin ×4, trigger). Full gates: typecheck/build, unit suites, FULL integration + rules suite (baseline 738 + new). Confirm zero firestore.rules changes and zero new indexes (guardianLinks familyId equality — single-field; notifications trigger — no queries beyond doc reads; listSupervisedAccounts full-collection admin scan is acceptable at this scale, comment it). Completion report.

## Self-review notes

- The regression contract of Tasks 3–4 is that EXISTING tests pass UNMODIFIED — the guardian path may only add behavior.
- Decline-only is pinned per callable with an explicit accept-attempt test.
- Guardian cancels flow through the SAME machinery (ledger restore, lateCancellation snapshots, notifications) — tests assert the machinery ran, not reimplementations.
- Mirror ids are deterministic; the trigger must be retry-safe.
- Oversight detail is consent-gated on ACTIVE links only; the list view may show pending/revoked rows (status-labelled) because it reveals only what the family already knows.
