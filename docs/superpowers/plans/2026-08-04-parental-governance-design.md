# Parental Governance — Approved Master Design (V2 feature 5)

Status: APPROVED by user 2026-08-04 after iterative review. This document is the
authoritative design for the ~5-PR governance milestone; each PR gets its own
implementation plan referencing this file.

## User rulings (verbatim intent, 2026-08-02 → 2026-08-04)

1. **Powers:** oversight + protective controls (no per-booking approval gate).
2. **Self-enrollment floor:** under-15s are BLOCKED from self-enrolling, using
   BOTH the entered dateOfBirth and the graduation year embedded in the EJM
   email (`name28@ejm.org`). Distinct rejection messages:
   - under-15 → "your parents can create an account and enroll you";
   - DOB/grad-year mismatch (but plausibly ≥15) → "contact EJM admin", with an
     admin-approvable exemption so a legitimate case can enroll.
3. **Parent-created kid accounts (any age):** a parent creates the account for
   their kid — enters the kid's EJM email + first/last name + DOB, approves the
   ToS + privacy policy + a dedicated **Supervision Agreement** (explains what
   governing means and the parent's responsibilities). Kid receives an invite,
   creates their login, completes enrollment themselves. Parent-entered
   email/name/DOB are IMMUTABLE for the kid (`identityLocked` rules pin);
   corrections only via guardian callable or admin. No age floor on this path —
   supervision is what makes young participation acceptable. Once enrolled,
   these accounts are fully functional (searchable/bookable); protection is
   oversight, not gating.
4. **Supervision is FAMILY-level:** guardianLinks reference a familyId; every
   parent in the family holds identical supervision rights (isFamilyMember
   authorization; notification mirroring via notifyAllParents). Guardian must
   have a parent profile + family (create one first if not). Multi-kid
   monitoring is first-class: one dashboard listing every supervised kid.
5. **15–17 self-enrolled:** supervision OPTIONAL — parent can ask; kid confirms
   in-app (an adult can never silently attach).
6. **Invite management:** cancel + resend (resend resets clock); 7-day validity;
   invite email must be @ejm.org with valid grad year (this rejection is safe to
   show). ANTI-ENUMERATION: the parent sees identical "invitation sent" in all
   three cases —
   a. no account → kid-account invite;
   b. account exists, unsupervised → silently becomes an ask-to-supervise
      request (parent-entered name/DOB NOT applied; existing accounts never get
      identityLocked);
   c. account exists, supervised by ANOTHER family → NO request created, ADMIN
      alerted (custody conflict / probing).
   A declined request and an ignored invite look identical to the parent.
7. **Supervision end:** parent (any family parent) or admin revokes, only when
   kid ≥15. Kid never self-revokes. NO 18-auto-expiry: providers are students
   only; the (future) annual summer revalidation feature is the account
   lifecycle terminus. Annual revalidation + post-graduation accounts are
   LEDGERED as separate roadmap items (revalidationYear fields exist but are
   dormant/unenforced today).
8. **Oversight depth:** guardians see EVERYTHING — sessions/appointments,
   schedules, pending requests, request messages, and ALL session notes (pre +
   post). The kid-facing transparency page says exactly this.
9. **Consent versioning:** ToS/privacy/Supervision-Agreement versions stored on
   the link from day one; re-approval prompt on version bump is a ledgered
   follow-up (not v1).

## Data model

- `guardianLinks/{childUid}` (doc id = child uid → one supervising family per
  child): `{ childUid, familyId, createdByParentUid, status:
  'pending'|'active'|'revoked', origin: 'parent_created'|'claim', requestedAt,
  confirmedAt?, revokedAt?, revokedByUid?, consent: { tosVersion,
  privacyVersion, supervisionAgreementVersion, approvedAt, approvedByUid } }`.
  This doc IS the GDPR consent record. Rules: read by child + family members +
  admin; ALL writes callable-only.
- `kidInvites/{inviteId}`: `{ kidEmail (lowercased, EJM-validated), firstName,
  lastName, dateOfBirth, familyId, createdByParentUid, consent {…}, status:
  'pending'|'accepted'|'cancelled'|'expired', createdAt, expiresAt (7d),
  resentAt? }`. Never readable by anyone but the family + admin (the kid
  redeems via a token/code path, not a doc read).
- Child user doc: `governedBy: { familyId, linkedAt }` mirror + (parent-created
  only) `identityLocked: true` — both server-owned, rules-pinned; the users
  update rule pins firstName/lastName/dateOfBirth whenever identityLocked.
- `enrollmentExemptions/{ejmEmailLower}`: `{ createdByUid, createdAt, note }`
  — admin-managed; waives the DOB/grad-year CONSISTENCY check only, never the
  self-enrollment under-15 floor.

## Age policy (shared-core helper)

School-year boundary is September (matching `getValidGraduationYears`):
`schoolYearEnd(now)` = calendar year if Paris month < September, else year+1. Expected age for a 2-digit grad year G:
`18 − (fullGradYear − schoolYearEnd)`. Checks:
- `ageFromDob < 15` → **under_15** (self-enrollment paths only).
- `|ageFromDob − expectedAge| > 1` (one-class tolerance) → **age_mismatch**
  (exemption-bypassable).
- Grad-year-only variant (sit account creation, where DOB is not yet known):
  `expectedAge + 1 < 15` → **under_15**.

## Enforcement anchoring (differs per app — discovered in recon)

- **study `enrollTutor`**: takes dateOfBirth server-side → FULL dual-signal
  check at enrollment. Error codes in HttpsError details:
  `age/under-15`, `age/mismatch`.
- **sit `enrollBabysitter`**: minimal callable (no DOB; profile completed by
  client-side writes afterwards) → grad-year-only check at account creation +
  **consumption backstop**: `searchBabysitters` excludes providers whose
  DOB says <15 or whose DOB/grad-year mismatch beyond tolerance (exemption doc
  read only on failure — rare). Missing-DOB legacy profiles are NOT excluded
  (count script measures them first). Sit appointment creation is client-side
  (no callable) → search is the operative gate; noted as accepted v1 scope.
- Client UX (both apps): friendly rendering of both error codes, EN/FR.

## Guardian surfaces (later PRs)

- Lifecycle callables: `createKidInvite` (branches silently per ruling 6),
  `redeemKidInvite` (kid: create login + account from invite identity,
  identityLocked, link active), `respondToSupervisionRequest` (kid
  confirm/decline), `cancelKidInvite`, `resendKidInvite`,
  `revokeSupervision` (family parent/admin, kid ≥15),
  `correctChildIdentity` (guardian/admin fixes name/DOB on identityLocked).
- Oversight: `getGovernedChildren` (dashboard cards) + `getGovernedChildDetail`
  (full view incl. notes/messages) — callable-based reads, NOT rules fan-out.
- Protective controls: hide from search, cancel session/appointment (reason
  required), decline pending request — audit-logged actor='guardian'.
- Notification mirroring: child notifications CC the supervising family via
  notifyAllParents.
- Admin: exemption management, supervised-accounts view w/ consent records,
  conflicting-claim alerts, force-revoke, family-transfer assist,
  grandfathering of any pre-existing under-15 accounts.
- GDPR: deleteUser — parent deletion keeps family supervision (co-parent);
  LAST parent deleted with under-15 governed kid → kid account deactivated +
  admin notified. Child deletion removes link + invites. exportUserData
  includes links/invites/consents.
- Kid transparency: "supervised account" indicator + explainer page (what
  guardians see, per ruling 8); Supervision Agreement static page EN/FR (copy
  drafted for user review in the UI PRs).

## PR breakdown

1. **feat/enrollment-age-gate** — age policy helper, both enrollment gates,
   exemptions + admin callable/UI, search backstop (sit), rejection UX both
   apps, count script. (THIS PR.)
2. **feat/guardian-foundation** — kidInvites + guardianLinks + lifecycle
   callables + identityLocked/governedBy pins + GDPR integration.
3. **feat/guardian-controls** — oversight callables, protective controls,
   notification mirroring, admin governance surfaces.
4. **feat/guardian-study-ui** — study-web surfaces.
5. **feat/guardian-sit-ui** — web (sit) surfaces.

## Ledger (deliberate deferrals)

Annual summer revalidation (app-wide, gates all providers); post-graduation
accounts; consent re-approval on version bump; server-side sit appointment
creation (would strengthen the sit backstop); supervision transfer self-serve
(admin-assisted in v1).
