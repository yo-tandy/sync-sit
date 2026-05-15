# Phase 3 Completion Report

> Prepared: 2026-05-14  
> Branch: `docs/phase-3-completion-report`  
> Scope: Phase 3 integration testing across all 6 domains (PRs #32, #34, #36, #37, #38, #39, #40, #41)

---

## §8.1 Test Count Totals

| Phase / Domain | PR | Status | Tests |
|---|---|---|---|
| Phase 1 — unit tests | #27 | Merged | 74 |
| Phase 3 — Domain 1: Appointments | #32 | Merged | 33 |
| Phase 3 — Domain 2: Verification | #34 | Merged | 47 |
| Phase 3 — Domain 3: Account management | #36 | Merged | 29 |
| Fix — GDPR co-parent delete | #37 | Merged | +1 regression |
| Phase 3 — Domain 5: References (trigger + rules) | #38 | Merged | 26 (5 integration + 21 rules) |
| Phase 3 — Domain 4: Contact sharing | #39 | **Open** | 16 |
| Phase 3 — Domain 6: Scheduled functions | #40 | **Open** | 10 |
| Fix — lookupBabysitter searchable flag | #41 | **Open** | +2 regression |

**Confirmed merged total: 74 + 33 + 47 + 29 + 1 + 26 = 210 tests**

**Full total (including open PRs): 210 + 16 + 10 + 2 = 238 tests**

> Note: A full local suite run against all branches combined was deferred per §8 option (a). The per-PR numbers above come from PR descriptions and local exit codes reported by each writer. The accurate merged count (210) will shift to the full count (238) once PRs #39, #40, and #41 are merged. A post-merge `pnpm test:integration` run is recommended to confirm the combined suite exits 0.

The original handoff target was ~200 tests at completion (projected ~195 including Phase 4 UI). Phase 3 alone has already surpassed that estimate; Phase 4 (UI) has not been started.

---

## §8.2 Test Plan Coverage Mapping

### Automated coverage by test-plan domain

| Test-plan section | IDs | Automated coverage | Notes |
|---|---|---|---|
| Auth & Enrollment (§1) | AUTH-001–AUTH-037 | Partial | Enrollment callable authz branches covered in verification tests (submit, review). Enrollment wizard itself (AUTH-001–019, AUTH-020–025) is UI-only; not automated. |
| Parent Invite (§1.3) | AUTH-026–AUTH-030 | None | Invite link issuance and join flow are client-initiated; no integration tests exist. P0/P1 remain manual. |
| Search & Matching (§2) | SRCH-001–SRCH-032 | Partial | `lookupBabysitter` search (PR #39) covers name/email match and searchable-flag exclusion (SRCH-019, SRCH-020 analogue). Full `searchBabysitters` endpoint not tested. SRCH-001–018, SRCH-021–032 remain manual. |
| Appointment Lifecycle (§3) | APPT-001–APPT-018 | Covered (PR #32) | All accept/decline/cancel callable paths, status transitions, schedule blocking/unblocking, and authz tested. APPT-005 (.ics download) is UI-only. |
| Babysitter Schedule (§4) | SCHED-001–SCHED-010 | Not directly | Schedule state side-effects are verified transitively in appointment tests. Direct schedule CRUD endpoints have no dedicated tests. |
| References (§5) | REF-001–REF-010 | Partially covered (PR #38) | REF-003 (family submits), REF-004 (pending until approved), REF-005 (babysitter approves) tested. REF-001, REF-002, REF-006, REF-007 (manual reference CRUD) not tested — no `createManualReference` callable found in source. REF-008, REF-009, REF-010 are UI-only. |
| Portal & Dashboard (§6) | PORT-001–PORT-015 | None | Entirely UI/FE; not applicable to backend integration tests. |
| Notifications (§7) | NOTIF-001–NOTIF-011 | Partially covered | Notification documents are asserted in appointment, scheduled, and references tests. Email/push delivery (NOTIF-001–008, NOTIF-011) is no-op under emulator and not asserted. NOTIF-009 (Aug 1 revalidation email) and NOTIF-010 (deletion notifications) are tested indirectly in scheduled + delete-user tests. |
| Revalidation (§8) | REVAL-001–REVAL-006 | Partial | Annual-revalidation state transitions (invalidation, block from search) covered indirectly in `deactivateUser` and `cleanupOldData` tests. REVAL-003/004 (dialog on login) are UI-only. |
| Account Management (§9) | ACCT-001–ACCT-006 | Covered (PR #36) | All 3 cascade paths tested (babysitter, sole parent, co-parent). ACCT-002 (re-enrollment after deletion) is UI-only. |
| Admin Portal (§10) | ADMIN-001–ADMIN-012 | Covered (PR #36) | `deleteUser`, `deactivateUser`, `exportUserData` authz, happy paths, and audit-log entries tested. ADMIN-005/006/007/008 are UI or admin-console only. |
| GDPR & Retention (§11) | GDPR-001–GDPR-006 | Partially covered (PR #40) | `cleanupOldData` tests cover GDPR-002 (soft-delete after 30d) and GDPR-003 (delete removes PI). GDPR-001 (1-week portal visibility) is UI-only. |
| Notifications delivery, cross-platform, i18n (§12–§14) | PLAT-001–I18N-006 | None | All UI/native-app concerns; not applicable to backend integration tests. |
| Edge Cases (§14) | EDGE-001–EDGE-010 | Partial | EDGE-009 (accept after cancel) is asserted in appointment tests. Double-submit (EDGE-006) is asserted in verification and appointment tests via idempotency paths. Others remain manual. |

### P0 cases remaining manual

The following P0 test-plan IDs have no automated coverage and require manual verification before each release:

- **AUTH-001–AUTH-005**: EJM email validation and graduation-year rollover (enrollment wizard)
- **AUTH-009, AUTH-010**: Password creation flow
- **AUTH-015**: Contact info requirement
- **AUTH-018, AUTH-019**: Duplicate email detection; complete enrollment
- **AUTH-020–AUTH-021**: Parent enrollment
- **AUTH-026–AUTH-030**: Parent invite link flow
- **AUTH-031–AUTH-034**: Login and forgot-password flows
- **SRCH-001–SRCH-006, SRCH-013, SRCH-019, SRCH-020, SRCH-021–SRCH-022**: Search filtering
- **SRCH-027, SRCH-028**: Contact request + babysitter contact info
- **SRCH-031, SRCH-032**: Multiple contacts; dashboard appearance
- **NOTIF-001–NOTIF-007, NOTIF-009, NOTIF-010**: Email delivery
- **PLAT-001–PLAT-006**: Cross-platform + push delivery
- **I18N-001, I18N-002**: Full UI localization
- **REF-004**: Reference pending until approved (covered in rules test but not end-to-end UI)
- **GDPR-003**: Right to be forgotten (tested at function level; full UI flow remains manual)
- **ADMIN-001, ADMIN-002, ADMIN-003, ADMIN-010**: Admin login and block actions
- **ACCT-001, ACCT-003, ACCT-004, ACCT-006**: Account self-deletion and leave-family flows

---

## §8.3 Consolidated Security Findings

Each finding is marked **[FIXED]**, **[OPEN — policy decision]**, **[OPEN — low severity]**, or **[OPEN — backlog]**.

### Finding 1 — Co-parent `createdByUserId` PII leak

- **Source**: PR #36 observation #1
- **Status**: **[FIXED — PR #37]**
- **Detail**: When a non-sole parent was deleted, their UID remained on `createdByUserId` fields of family appointments. Fixed by always running a redaction pass on family appointments regardless of `isLastParent`. A focused regression test was added.

### Finding 2 — `removeCoParent` leaves orphan parent accounts

- **Source**: PR #36 observation #2
- **Status**: **[OPEN — policy decision]**
- **Detail**: `removeCoParent` unsets `familyId` on the removed parent's user doc but does not delete their Firebase Auth account or user doc. The orphaned user can still log in and reach UI states that assume a family. Needs FE verification that `familyId === undefined` is handled gracefully.

### Finding 3 — `exportUserData` omits its own audit log from the returned payload

- **Source**: PR #36 observation #3
- **Status**: **[OPEN — low severity]**
- **Detail**: The export action is logged in Firestore after the data query runs, so it does not appear in the returned JSON. The log is still written; only the payload is incomplete. Minor inconsistency.

### Finding 4 — `deleteUser` audit log retains PII (GDPR tension)

- **Source**: PR #36 observation #4
- **Status**: **[OPEN — policy decision]**
- **Detail**: The audit log stores `email`, `firstName`, and `lastName` in `details` for `deleteUser` actions. A hard-delete that retains PII in an admin-only audit log is a GDPR tension. Currently mitigated by admin-only access. A formal data-retention policy for audit logs should be documented.

### Finding 5 — Community-approval transitive-trust chain

- **Source**: PR #34 security gap #2
- **Status**: **[OPEN — policy decision]**
- **Detail**: `lookupCommunityCode` and `approveCommunityCode` gate on `isFullyVerified && isEjmFamily`. If those flags drift out of sync (e.g., a community-approved family approving a third family) a transitive-trust chain can form. Needs a separate audit of the trust model.

### Finding 6 — `approveCommunityCode` overwrites prior verification state

- **Source**: PR #34 security gap #1
- **Status**: **[OPEN — policy decision]**
- **Detail**: Approving a community code sets `isFullyVerified: true` and writes `communityApprovedBy: uid` but does not preserve or record which prior document IDs are being superseded. A family with a previously rejected identity doc is fully verified by community approval with no audit trail of what was overridden.

### Finding 7 — `lookupBabysitter` ignored `searchable` flag (privacy bug)

- **Source**: PR #39 gap note; PR #41 fix
- **Status**: **[FIXED — PR #41]**
- **Detail**: `lookupBabysitter` queried only on `status == 'active'`, so babysitters who set `searchable: false` (opted out of discovery) still appeared in family name/email searches. Fixed by adding `.where('searchable', '==', true)` to the query. Two regression tests added.

### Finding 8 — `respondToContactSharing` has no double-response guard

- **Source**: PR #39 observation #1
- **Status**: **[OPEN — low severity]**
- **Detail**: A babysitter can approve or decline an already-approved or already-declined contact-sharing request with no error. The status is silently overwritten. Low risk (babysitter-only action on their own request) but could create confusing audit state.

### Finding 9 — `removePreferredBabysitter` leaves orphan sharing request

- **Source**: PR #39 observation #2
- **Status**: **[OPEN — low severity]**
- **Detail**: Removing a babysitter from a family's favorites does not clean up any existing `contactSharingRequests` document. A pending or approved request remains in Firestore after the preference is removed. Data inconsistency; no immediate security risk.

### Finding 10 — References permissive read rule

- **Source**: PR #38 security observation #1
- **Status**: **[OPEN — low severity]**
- **Detail**: Any authenticated user can read any reference document (`allow read: if isAuth()`). This is intentional for search results showing endorsements, but means parents can read all references for all babysitters without restriction. If endorsement visibility becomes user-configurable, the rule needs narrowing.

### Finding 11 — References are client-written with no server-side validation

- **Source**: PR #38 security observation #2
- **Status**: **[OPEN — backlog]**
- **Detail**: References are written directly via the client SDK. A malicious parent could submit a reference with a fabricated `submittedByUserId` matching their own UID and any `babysitterUserId`. The Firestore rules allow create when `submittedByUserId == request.auth.uid`, so the create is accepted. A Cloud Function intermediary or a server-side `reviewedAt` gate would close this.

### Finding 12 — No rate limiting on reference creation

- **Source**: PR #38 security observation #3
- **Status**: **[OPEN — low severity]**
- **Detail**: A parent can write unlimited references for the same babysitter, generating unlimited `notifyOnNewReference` trigger invocations and in-app notification documents. Low concern at current scale.

### Finding 13 — `sendReminders` non-atomic `reminderSent` flag

- **Source**: PR #40 security/reliability observation
- **Status**: **[OPEN — low severity]**
- **Detail**: `runSendReminders` creates notification documents and then sets `reminderSent: true` in a separate `update()` call. A process crash between those two operations would result in duplicate reminder notifications on the next hourly run. The 2-hour window means at most one duplicate per appointment per crash.

---

## §8.4 Future Refactoring Backlog

### High priority

1. **`deleteUser` extraction into pure cascade helpers**
   `deleteUser.ts` is a 197-line function executing 7 distinct cascade steps (`anonymizeBabysitterAppointments`, `cascadeFamilyDelete`, babysitter-schedule cleanup, notification cleanup, auth-account deletion, audit-log write, cross-family notification). Each step is independently testable if extracted to a pure helper. Currently the entire function must be tested end-to-end via the emulator.

2. **`deleteUser` cross-collection cascade lacks transactionality**
   If `adminAuth.deleteUser()` fails after Firestore mutations, the user doc is gone but the Auth account remains, leaving the user unable to log in but with an orphaned Auth record. Currently the function swallows `auth/user-not-found` only. Other Auth errors leave inconsistent state silently.

3. **`searchBabysitters` searchable-flag audit**
   PR #41 fixed `lookupBabysitter`; the `searchBabysitters` function (used for the main search flow) was not audited for the same issue. Per the contact-sharing-writer's note in PR #41, `searchBabysitters` should be reviewed to confirm it filters on `searchable == true`. If not, this is a second instance of the same privacy bug.

### Medium priority

4. **`runCleanupOldData` batch limit**
   The cleanup function processes records in a single Firestore batch (500-document limit). On days with heavy activity, records beyond 500 are silently skipped. A loop-until-empty pattern would be correct.

5. **`waitForNotification` polling helper deduplication**
   The trigger-test polling pattern (`waitForDoc`) is copy-pasted in references tests and appointment tests. Extract to `tests/setup/emulator.ts` for shared reuse.

6. **Verification-status recompute extraction**
   `reviewVerification` re-fetches all family documents and reduces locally to recompute status. Extracting this to a pure `recomputeVerificationStatus(familyId, db)` helper would allow direct unit testing without the emulator.

7. **`respondToContactSharing` double-response guard**
   A `respondedAt` or status check at the start of `respondToContactSharing` would prevent a babysitter from silently overwriting a prior approve/decline decision.

8. **`removePreferredBabysitter` request cleanup**
   When a babysitter is removed from `preferredBabysitters`, the function should also update or delete any existing `contactSharingRequests` document for that babysitter–family pair.

### Low priority / Phase 4 prep

9. **Phase 4 UI component tests** — not started. Setup steps are documented in the prior handoff doc (§6). Requires a framework decision (Playwright vs. Vitest + Testing Library) and a separate scoping session.

10. **`notifPrefs.reminders = false` test coverage**
    PR #40 does not include a test for the case where a babysitter has `notifPrefs.reminders.push = false, email = false`. The notification should not be created in that case; the current tests only exercise the `push: true` path.

11. **Shared `parentName` formatter**
    The pattern `${firstName} ${lastName.toUpperCase()}` is repeated in multiple family functions. A shared formatter in `packages/shared` would reduce drift risk.

---

## Open PRs awaiting review

| PR | Title | Status |
|---|---|---|
| #39 | test(family): 16 integration tests for contact sharing | Open |
| #40 | Phase 3 domain 6: scheduled function tests | Open |
| #41 | fix(family): respect searchable flag in lookupBabysitter | Open |

Recommended merge order: **#41 → #39 → #40** (fix first, then tests, then the refactor-adjacent scheduled PR last).

After all three are merged, run `pnpm test:integration` from the repo root to confirm the combined suite exits 0.
