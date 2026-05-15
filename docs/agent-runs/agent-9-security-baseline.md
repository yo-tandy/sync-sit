# Agent 9 — Phase 0 Security Baseline

**Status:** Baseline established. PASS for Phase 0 (no remediation required to start Phase 1, though several findings flagged for later phases).

**Author:** agent-9-security
**Date:** 2026-05-15
**Branch:** `feature/sync-study-agent-9-security`
**Scope source:** `docs/sync-study-project-plan.md` §8 — Agent 9 task list, item 1 (Phase 0 deliverable).

---

## 1. Purpose & scope

This document is the **read-only snapshot** of the security and privacy posture of the sync-sit codebase as it stood at the start of the sync-study extraction work. Every per-phase review report (`agent-9-phase-N-review.md`) compares the diff for that phase against this baseline. Anything not allowed here, that becomes allowed later, is a regression that Agent 9 must call out.

**Code surface in scope:**
- All Cloud Functions in `apps/functions/src/**` (37 named exports across 11 domain folders — see §2).
- `firestore.rules` (138 lines).
- `storage.rules` (30 lines).
- `firebase.json` (region & runtime config).
- `apps/functions/src/config/*` (admin SDK initialization, email, push, CORS, parent-notification fan-out).
- The two scheduled functions in `apps/functions/src/scheduled/`.
- The eleven admin functions in `apps/functions/src/admin/`.

**Out of scope:**
- Client-side React code (`apps/web/`) — Agent 9 audits server-side authorization; client-side guards are defense-in-depth, not the primary boundary.
- Future sync-study surfaces (`apps/study/`, `study-sessions/`, `study-searches/`) — those don't exist yet; they are the subject of post-Phase-3 and post-Phase-4 reviews.
- Build/deploy infrastructure (`scripts/bundle-shared-for-deploy.js` etc.) — out of security scope unless they touch secrets.

**Sibling lint-cleanup branch:** `feature/sync-study-sit-lint-cleanup` is in flight in a separate worktree. It is reviewed separately on coordinator request; this baseline reflects the state of `feature/sync-study-orchestration` (HEAD = `7eb83e7`).

---

## 2. Auth model — per Cloud Function

Every export in `apps/functions/src/index.ts` is below. Trigger types: **callable** = `onCall` (HTTPS callable, region locked, requires Firebase Auth ID token only if the function explicitly checks `request.auth`); **firestore-trigger** = `onDocumentCreated` etc. (runs as the Functions service account, no end-user auth context); **scheduled** = `onSchedule` (runs as the service account on cron). All callables have `cors: getCorsOrigin()` which returns `true` (open CORS — see §5 for the rationale).

### 2.1 Auth (3 callables — all unauthenticated by design)

| Function | Trigger | `request.auth` required? | Role/claim check | Scope check | Notes |
|---|---|---|---|---|---|
| `verifyEjmEmail` | callable | **No** | none | EJM-email regex (`@ejm.com`) UNLESS pre-approved (`preapprovedEmails/{email}.used == false`). Stores 6-digit code in `verificationCodes/{email}` (10 min TTL, max 5 attempts). | Pre-enrollment. Generates code via `crypto.randomInt`. Calls `sendVerificationEmail`. |
| `verifyParentEmail` | callable | **No** | none | basic email-regex only — accepts any domain. Same code/TTL/attempts mechanism. | Pre-enrollment for parents. **No domain restriction** — anyone can request a code to any email they control (which is the point: parents need to verify their own email). |
| `verifyCode` | callable | **No** | none | Reads `verificationCodes/{email}`, checks `expiresAt`, increments `attempts` on miss, fails after 5. | No state mutation on success — only validates. Used by enrollment flow. |

### 2.2 Enrollment (6 callables)

| Function | Trigger | `request.auth` required? | Role/claim check | Scope check | Notes |
|---|---|---|---|---|---|
| `enrollBabysitter` | callable | **No** (creates the auth user itself) | none | Re-validates the verification code (expiry, attempts, exact match), validates password via `strongPasswordSchema`, requires `consentVersion`. | Calls `adminAuth.createUser`. Writes `users/{uid}` (role=babysitter), `schedules/{uid}` (empty 96-slot weekly grid). Deletes verification code on success. |
| `enrollFamily` | callable | **No** (creates the auth user itself) | none | Same code re-validation as above. Validates payload via `familyEnrollmentSchema`. | Creates `users/{uid}` (role=parent), `families/{familyId}` with `parentIds: [uid]`, optional `families/{familyId}/kids/*`. |
| `generateInviteLink` | callable | **Yes** | none | Caller's uid must be in `families/{familyId}.parentIds`. | 32-byte hex token, 7-day TTL, written to `inviteLinks/{token}`. |
| `validateInviteLink` | callable | **No** (intentional — public proxy) | none | Reads `inviteLinks/{token}`, returns ONLY `familyName`. | Designed to keep `inviteLinks` Firestore-private (rule = deny) while allowing the `/join/{token}` web page to render the family name before the joiner authenticates. |
| `joinFamily` | callable | **No** (creates the auth user itself) | none | Token must exist + not used + not expired. Verification-code re-validation. | Creates new auth user, adds to `families/{familyId}.parentIds`, marks invite `used`. |
| `removeCoParent` | callable | **Yes** | caller must be `role=='parent'` | Caller and target must share `familyId`. Caller cannot remove themselves. | Removes target from `families/{familyId}.parentIds`, deletes `users/{target}.familyId` field. **Does NOT delete the user account** — target stays as a parent with no family. |

### 2.3 Search (2 callables)

| Function | Trigger | `request.auth` required? | Role/claim check | Scope check | Notes |
|---|---|---|---|---|---|
| `searchBabysitters` | callable | **Yes** | If caller is `role=='parent'`: `families/{familyId}.verification.isFullyVerified` must be `true` (else permission-denied). If caller has no family or no role, runs anyway with no preferred-set. | None on the per-babysitter level — fan-out reads all `users where role==babysitter, status==active, searchable==true`. | Server-side withholding: `contactEmail`/`contactPhone` are returned ONLY if the babysitter's `approvedFamilies` includes the caller's `familyId`. Otherwise `undefined`. |
| `sendContactRequest` | callable | **Yes** | none beyond auth | Caller's uid must be in `families/{familyId}.parentIds` AND `families.verification.isFullyVerified`. Babysitter must exist + `status=='active'`. | Writes `searches/{searchId}`, `appointments/{apptId}` (status=pending), `notifications/*`. Sends email + push + in-app to babysitter. |

### 2.4 Family (4 callables)

| Function | Trigger | `request.auth` required? | Role/claim check | Scope check | Notes |
|---|---|---|---|---|---|
| `addPreferredBabysitter` | callable | **Yes** | caller must be `role=='parent'` with a `familyId` | Babysitter must exist with `role=='babysitter'`. | `arrayUnion` to `families.preferredBabysitters`. If no existing `contactSharingRequests` record for the pair, creates one (status=pending) AND sends notifications to babysitter. |
| `removePreferredBabysitter` | callable | **Yes** | caller must be `role=='parent'` with a `familyId` | none beyond above | `arrayRemove` from `families.preferredBabysitters`. **Does NOT clean up `contactSharingRequests` or revoke `approvedFamilies`** — the share remains. |
| `lookupBabysitter` | callable | **Yes** | caller must be `role=='parent'` with a `familyId` | Query length ≥ 2. | In-memory linear scan over ALL `babysitter` users matching `firstName/lastName` substring or exact email match, capped at 10 results. Returns no contact info. |
| `respondToContactSharing` | callable | **Yes** | none beyond auth | Caller's uid must equal `contactSharingRequests/{requestId}.babysitterUserId`. | On approve: arrayUnion `families.familyId` into `users/{uid}.approvedFamilies`. On decline: just sets status. |

### 2.5 Appointments (6 callables)

| Function | Trigger | `request.auth` required? | Role/claim check | Scope check | Notes |
|---|---|---|---|---|---|
| `respondToRequest` | callable | **Yes** | none beyond auth | Caller's uid must equal `appointments.babysitterUserId`. Status must be `pending`. | On accept: writes `schedules/{uid}/overrides/{date}` (if `blockSchedule:true`). Notifies all parents in family via `notifyAllParents`. |
| `cancelAppointment` | callable | **Yes** | caller's role must be `babysitter` (and own the appt) OR `parent` (and share family) | Status must be `pending`/`confirmed`. Reason is required. | Notifies the OTHER party only. |
| `modifyAppointment` | callable | **Yes** | caller must be `role=='parent'` | Caller's `familyId` must match `appointments.familyId`. Status must be `pending`/`confirmed`. | Tracks `modifiedFields[]` for the babysitter to acknowledge. Re-denormalizes `kids[]` from `families/{familyId}/kids/*` if `kidIds` changed. |
| `acknowledgeModification` | callable | **Yes** | none beyond auth | Caller's uid must equal `appointments.babysitterUserId`. | Clears the `modified` flag. |
| `getParentContacts` | callable | **Yes** | none beyond auth | Caller's uid must equal `appointments.babysitterUserId`. | Returns `firstName/lastName/email/phone/whatsapp` for every parent in `families.parentIds`. **PII boundary** — only the assigned babysitter ever sees parent contact info. |
| `resubmitAppointment` | callable | **Yes** | caller must be `role=='parent'` | Caller's `familyId` must match original `appointments.familyId`. Original must be `status=='rejected'`. `additionalNotes` is mandatory. | Atomic batch: creates new appointment + marks original `resubmitted: true`. |

### 2.6 Verification (8 callables)

| Function | Trigger | `request.auth` required? | Role/claim check | Scope check | Notes |
|---|---|---|---|---|---|
| `submitVerification` | callable | **Yes** | caller must be `role=='parent'` with a `familyId` | none beyond above | Deletes any existing `verifications` of the same type for this family before creating new one. Sets `families/{familyId}.verification.{identityStatus|enrollmentStatus}=pending`. Notifies admin via email. |
| `reviewVerification` | callable | **Yes** | `verifyAdmin(uid)` — checks `users/{uid}.role == 'admin'` | none | Recomputes `families.verification.{identityStatus, enrollmentStatus, isFullyVerified, isEjmFamily}` after every decision. Writes audit log. |
| `listPendingVerifications` | callable | **Yes** | `verifyAdmin(uid)` | none | Returns enriched list with `familyName/parentName/familyKids/familyParentNames`. |
| `getVerificationStatus` | callable | **Yes** | caller must be `role=='parent'` with a `familyId` | Returns own family only (queries by caller's `familyId`). | Lists all `verifications` documents for that family. |
| `generateCommunityCode` | callable | **Yes** | caller must be `role=='parent'` with a `familyId` | Family must NOT already be `isFullyVerified`. | 6-char alphanumeric code (3 random bytes hex), 24-hour TTL, written to `communityVerificationCodes/{code}`. Old unused codes for the same family are deleted first. |
| `lookupCommunityCode` | callable | **Yes** | caller must be `role=='parent'` with a `familyId` AND family `isFullyVerified` AND `isEjmFamily` | Code must exist + unused + unexpired. **Self-approval blocked** (caller's familyId ≠ code's familyId). | Read-only lookup — returns `familyName/firstName/lastName/familyId` of the requester. Same gating as `approveCommunityCode`. |
| `approveCommunityCode` | callable | **Yes** | same as `lookupCommunityCode` | same as `lookupCommunityCode` | Marks code `used`, sets target family's `verification.{identityStatus,enrollmentStatus}='approved', isFullyVerified=true, isEjmFamily=true, communityApprovedBy=<uid>`. **Bypasses admin review for community-EJM families.** |
| `getVerificationDocument` | callable | **Yes** | none beyond auth | Path must start with `verification-documents/`. Caller must be (a) `role=='admin'` OR (b) `role=='parent'` with `familyId == path.familyId`. | Returns 15-minute signed Storage URL. **The only path** to read these documents — `storage.rules` denies direct reads. |

### 2.7 References (1 Firestore trigger, 0 callables)

| Function | Trigger | Auth context | Scope check | Notes |
|---|---|---|---|---|
| `notifyOnNewReference` | firestore-trigger on `references/{referenceId}` create | service account (no end-user auth) | only acts when `data.type == 'family_submitted'` | Sends email + push + in-app notification to the babysitter. **No write-side validation here** — the create is gated by `firestore.rules` instead. (See §3 for the rule analysis.) |

### 2.8 Scheduled (2)

| Function | Trigger | Schedule | Region | Notes |
|---|---|---|---|---|
| `sendReminders` | scheduled | `every 1 hours`, `Europe/Paris` | europe-west1 | For confirmed appointments in the 24-25 h window with `reminderSent != true`: notifies babysitter + all family parents per their `notifPrefs.reminders`, marks `reminderSent: true`. |
| `cleanupOldData` | scheduled | `every day 03:00`, `Europe/Paris` | europe-west1 | GDPR retention: deletes `notifications` >30 days, `auditLogs` >30 days, expired `inviteLinks`, expired `verificationCodes`, and `appointments` with `status in [cancelled, rejected]` >30 days AND booking date >7 days ago. Each query capped at 500/run. |

### 2.9 Admin (13 callables — all gated by `verifyAdmin`)

Every admin callable starts with `if (!request.auth) throw 'unauthenticated'` then `await verifyAdmin(request.auth.uid)`. `verifyAdmin` reads `users/{uid}` and asserts `role == 'admin'`. There is **no Firebase Auth custom claim** for admin — the role check goes through Firestore on every call. (See §7 [WATCH-1].)

| Function | Notes |
|---|---|
| `getAdminDashboard` | Counts: babysitters active, families, appointments total, pending verifications. |
| `listUsers` | Filterable by role/status, in-memory case-insensitive search on firstName/lastName/email (fetches up to 500 then filters). |
| `blockUser` | Toggles `users.status` between `active`/`blocked` AND `adminAuth.updateUser(uid, {disabled})`. |
| `deleteUser` | **GDPR hard-delete** — see §6 for the full trace. Anonymizes `appointments.babysitterUserId` to `'deleted'`, deletes notifications, schedule + overrides (babysitter), kids subcollection + family doc (last parent), then `users/{uid}` doc, then Firebase Auth account. |
| `resetUserPassword` | Returns a `generatePasswordResetLink` for the admin to forward. |
| `listAppointments` | Enriched with babysitter + parent names. |
| `deleteAppointment` | Hard-deletes the appointment doc + notifies both parties by email + writes audit log. |
| `updateHolidays` | Writes `holidays/{schoolYear}`. |
| `listAuditLogs` | Pageable, filterable by action. Enriched with email/name/role per uid. |
| `exportUserData` | **GDPR DSR — see §6.** Fetches user doc, family doc, all appointments where the user is babysitter or family-member, all `notifications.recipientUserId == uid`, all `auditLogs.targetUserId == uid`. Returns as a single JSON object. |
| `deactivateUser` | Toggles `users.searchable` for babysitters only. |
| `addPreapprovedEmail` / `removePreapprovedEmail` / `listPreapprovedEmails` | Manage `preapprovedEmails/{email}` for non-EJM-domain test/invite babysitter accounts. |

---

## 3. Firestore rules summary

Source: `firestore.rules` (138 lines). Helpers defined at the top:
- `isAuth()` — `request.auth != null`
- `isOwner(userId)` — `isAuth() && request.auth.uid == userId`
- `isAdmin()` — `isAuth() && get(users/{uid}).data.role == 'admin'` (Firestore-roundtrip on every check — see §7 [WATCH-1])
- `isFamilyMember(familyId)` — `isAuth() && request.auth.uid in get(families/{familyId}).data.parentIds`

A trailing `match /{document=**} { allow read, write: if false; }` denies everything not explicitly matched.

| Collection | Read | Create | Update | Delete | Field-level protections | Notes |
|---|---|---|---|---|---|---|
| `users/{userId}` | owner OR admin OR (any auth user, IF target is `role==babysitter, status==active`) OR (any auth user, IF target is `role==parent` AND target's `familyId == caller's familyId`) | **deny** (cloud-functions only) | owner only AND must NOT change `role,status,uid,email,ejemEmail,createdAt` | **deny** | `searchable, approvedFamilies, fcmTokens, hourlyRate, contactEmail/Phone, photoUrl, areaMode, areaLatLng, areaRadiusKm, ...` are **all writable by the owner** (see [WATCH-2], [BLOCK-LATER-2] for `approvedFamilies`, and [WORKING-AS-INTENDED-1] for `searchable`). | The babysitter-read clause exposes the full babysitter doc, including PII fields like `dateOfBirth, phone, whatsapp, contactEmail, contactPhone` — see §4 and [BLOCK-LATER-3]. |
| `families/{familyId}` | family member OR admin | **deny** | family member, **with NO field-level guard** | **deny** | A parent can flip `verification.isFullyVerified=true`, mutate `parentIds`, or change `verification.isEjmFamily` directly via the client SDK — bypassing the admin/community-code flow. **[BLOCK-LATER-1]** |
| `families/{familyId}/kids/{kidId}` | family member OR admin | family member | family member | family member | none | `kid.firstName, age, languages` only. |
| `schedules/{userId}` | owner | owner | owner | owner | none | Babysitter writes their own weekly grid. |
| `schedules/{userId}/overrides/{date}` | owner | owner | owner | owner | none | Note: `respondToRequest` writes to this subcollection from the Cloud Function (using admin SDK, which bypasses rules). |
| `searches/{searchId}` | family-member-via-`resource.data.familyId` | **deny** (cloud-functions only) | **deny** | **deny** | none | Created by `sendContactRequest`. |
| `appointments/{appointmentId}` | involved babysitter OR family-member-via-`resource.data.familyId` OR admin | **deny** (cloud-functions only) | **deny** | **deny** | none | Every mutation goes through a callable. |
| `references/{referenceId}` | any authenticated user | any auth user, IF `request.resource.data.babysitterUserId == request.auth.uid` OR `submittedByUserId == request.auth.uid` | same as create | **deny** | none | A user can create a reference about themselves (self-puffery via the babysitterUserId branch) — see [BLOCK-LATER-3]. World-readability noted at [WATCH-3]. Post-security-fix carry-overs (rule-layer fix can't verify submitter↔babysitter relationship; legitimate publish path needs a callable): see [BLOCK-LATER-5] and [BLOCK-LATER-6]. |
| `notifications/{notifId}` | recipient only | **deny** | recipient only AND **only the `read` field may be changed** | **deny** | `affectedKeys().hasOnly(['read'])` enforced. | One of the only field-level guards in the file. |
| `inviteLinks/{token}` | **deny** | **deny** | **deny** | **deny** | n/a | Validated via `validateInviteLink` Cloud Function. |
| `verificationCodes/{email}` | **deny** | **deny** | **deny** | **deny** | n/a | Used only by `verifyEjmEmail/verifyParentEmail/verifyCode/enroll*/joinFamily`. |
| `holidays/{schoolYear}` | any authenticated user | **deny** | **deny** | **deny** | n/a | Public reference data. |
| `auditLog/{logId}` | admin only | **deny** | **deny** | **deny** | n/a | **NOTE: dead rule.** All Cloud Functions write to and read from `auditLogs` (plural — see `writeAuditLog.ts:17`, `cleanupOldData.ts:45`, `listAuditLogs.ts:27`, `exportUserData.ts:65`). The `auditLog` (singular) rule guards a collection that no production code uses. The actual `auditLogs` collection has no rule and falls under the default-deny — which is the safe failure mode (clients can't read directly; they MUST go through `listAuditLogs`). [WATCH-4] |
| `contactSharingRequests/{requestId}` | involved babysitter OR family member OR admin | **deny** (cloud-functions only) | **deny** | **deny** | none | Created by `addPreferredBabysitter`, mutated by `respondToContactSharing`. |
| `communityVerificationCodes/{code}` | implicit deny (no rule) | implicit deny | implicit deny | implicit deny | n/a | Falls under the default-deny tail. Used only by callables. |
| `preapprovedEmails/{email}` | implicit deny | implicit deny | implicit deny | implicit deny | n/a | Falls under default-deny. Used only by `verifyEjmEmail` (read) + admin callables. |

### 3.1 Storage rules summary

Source: `storage.rules` (30 lines). All paths default-deny via the trailing `/{allPaths=**}`.

| Path | Read | Write | Notes |
|---|---|---|---|
| `verification-documents/{familyId}/{allPaths=**}` | **deny** | any authenticated user | Reads go through `getVerificationDocument` Cloud Function (15-min signed URL). Writes have **no familyId-membership check at the storage layer** — any authenticated user can upload to any familyId path. The Cloud Function only consumes paths that match `verification-documents/`, and `submitVerification` is the only writer in practice; abuse would require a malicious client crafting the path. [WATCH-5] |
| `profile-photos/{fileName}` | any authenticated user | any authenticated user, IF `fileName[0:request.auth.uid.size()] == request.auth.uid` | Prefix-equality check. Firebase UIDs are 28 chars from `[A-Za-z0-9_-]` and are not prefixes of one another in practice, so this is safe in steady state. Not strict equality though — a user can write `<uid>anything.jpg` (only their own paths). No content-type or size limit. [INFO] |
| `family-photos/{allPaths=**}` | any authenticated user | any authenticated user | **No ownership check.** Any authenticated user can read OR overwrite any family photo. [WATCH-6] |
| anything else | **deny** | **deny** | Default-deny tail. |

---

## 4. PII inventory

Personal data, classified per the brief. **Direct identifier** = identifies a natural person; **Quasi-identifier** = could re-identify in combination; **Sensitive** (GDPR Art. 9) = special category; **Behavioural** = activity/transaction history.

### 4.1 `users/{uid}` — 100% of natural-person records

Field set varies by `role` (`babysitter | parent | admin`). Common to all roles unless noted.

| Field | Class | Notes |
|---|---|---|
| `uid` | Direct (pseudonym) | Firebase Auth uid. |
| `email` | Direct | Lowercased on write. |
| `ejemEmail` | Direct | Babysitters only — institutional email. |
| `role` | n/a | `babysitter | parent | admin`. |
| `status` | n/a | `active | blocked`. |
| `firstName, lastName` | Direct | Plain strings. |
| `phone, whatsapp` | Direct | Optional. Parents set these via profile edit. |
| `contactEmail, contactPhone` | Direct | Babysitters only. Returned by `searchBabysitters` ONLY when `approvedFamilies` includes caller's familyId. |
| `dateOfBirth` | Direct (Sensitive — minor data implied) | Babysitters only. Used to compute age. |
| `photoUrl` | Direct (face image) | Stored at `profile-photos/{uid}.{ext}`. |
| `gender` | Quasi | Babysitters only. Used as a search filter. |
| `classLevel` | Quasi | Babysitters only — school class. |
| `languages[]` | Quasi | Babysitters only. |
| `aboutMe` | Quasi | Free text — could contain anything the babysitter writes. |
| `kidAgeRange{min,max}, maxKids` | Behavioural | Babysitters only. |
| `hourlyRate` | Behavioural | Babysitters only. |
| `areaMode, areaLatLng, areaRadiusKm` | Quasi (location) | Babysitters only — work area. lat/lng narrows to a residential district. |
| `searchable` | n/a | Babysitter discoverability flag. |
| `approvedFamilies[]` | Behavioural | Babysitters only — list of family IDs the babysitter has shared contact with. |
| `familyId` | n/a (linkage) | Parents only. |
| `fcmTokens[]` | Direct (device fingerprint) | Per-device push token. Owner can update. |
| `notifPrefs` | n/a | Object of channel toggles. |
| `language` | Quasi | UI language. |
| `consentAt, consentVersion` | n/a | GDPR consent record. |
| `createdAt, updatedAt` | n/a | Timestamps. |
| `enrollmentComplete` | n/a | Babysitters only. Onboarding flag. |

### 4.2 `families/{familyId}`

| Field | Class | Notes |
|---|---|---|
| `familyName` | Direct (surname) | Free text. |
| `address` | Direct (location) | Plain string. |
| `latLng{lat,lng}` | Direct (location) | Geocoded address. |
| `photoUrl` | Direct (face image — likely) | Stored at `family-photos/**` — note ownership hole [WATCH-6]. |
| `pets, note` | Quasi | Free text. |
| `parentIds[]` | n/a (linkage) | Source of truth for membership; consumed by every Cloud Function and rule helper. |
| `searchDefaults` | Behavioural | Filters object. |
| `preferredBabysitters[]` | Behavioural | Linkage. |
| `verification.{identityStatus, enrollmentStatus, isFullyVerified, isEjmFamily, communityApprovedBy}` | n/a | Verification state. **Mutable by family member with no field-level guard — see [BLOCK-LATER-1].** |
| `status` | n/a | `active`. |
| `createdAt, updatedAt` | n/a | Timestamps. |

### 4.3 `families/{familyId}/kids/{kidId}` — minor data

| Field | Class | Notes |
|---|---|---|
| `kidId` | Pseudonym | Generated. |
| `firstName` | Direct (minor) | Plain string. |
| `age` | Quasi (minor) | Integer. |
| `languages[]` | Quasi | List. |

**Note:** kid records contain ONLY `firstName + age + languages`. No DOB, no last name, no school, no medical info. This is intentional minimization.

### 4.4 `verifications/{verificationId}` — Sensitive (Art. 9)

| Field | Class | Notes |
|---|---|---|
| `verificationId` | Pseudonym | Generated. |
| `familyId` | Pseudonym | Linkage. |
| `uploadedByUserId` | Pseudonym | Linkage. |
| `type` | n/a | `identity | ejm_enrollment`. |
| `status` | n/a | `pending | approved | rejected`. |
| `fileUrl, fileName` | Direct + **Sensitive** | Pointer to a Storage object containing an ID document or school enrollment certificate (with child's name + DOB + school). |
| `rejectionReason` | n/a | Admin free text. |
| `reviewedByAdminId, reviewedAt` | n/a | Linkage + timestamp. |
| `createdAt` | n/a | Timestamp. |

### 4.5 `appointments/{appointmentId}` — Behavioural + Direct

| Field | Class | Notes |
|---|---|---|
| `appointmentId, searchId` | Pseudonym | Linkage. |
| `babysitterUserId, familyId, createdByUserId` | Pseudonym | Linkage. |
| `familyName, familyPhotoUrl` | Direct (denormalized from `families`) | Cached for display. |
| `address, latLng` | Direct (location) | Booking address. |
| `date, startTime, endTime, recurringSlots, schoolWeeksOnly, type, status, statusReason` | Behavioural | Booking details. |
| `kidIds[], kids[{age, languages}]` | Quasi (minor) | Denormalized — note: only `age` + `languages`, no name. |
| `offeredRate` | Behavioural | Money. |
| `message, additionalInfo, pets, familyNote` | Free-text | Could contain anything. |
| `cancellationReason` | Free-text | Captured at cancel time. |
| `modified, modifiedAt, modifiedFields, confirmedAt, cancelledAt, cancelledFromStatus, reminderSent, isResubmission, resubmittedFromAppointmentId, createdAt, updatedAt` | n/a | State + timestamps. |

### 4.6 `references/{referenceId}` — Direct

Schema not fully spelled out in any single function file — usage drawn from `searchBabysitters` (`status in [approved, published]`, `babysitterUserId`), `onReferenceCreated` (`type == 'family_submitted'`, `submittedByName`, `refName`), and `firestore.rules` (`babysitterUserId`, `submittedByUserId`).

| Field | Class | Notes |
|---|---|---|
| `babysitterUserId, submittedByUserId` | Pseudonym | Linkage. |
| `submittedByName | refName` | Direct (name) | Free text — name of the person endorsing. |
| `type` | n/a | `family_submitted | ...` |
| `status` | n/a | `approved | published | ...` |
| (body text — confirmed in field-level analysis later) | Free-text | Endorsement content. |

### 4.7 Other collections (linkage / non-PII)

| Collection | PII content | Notes |
|---|---|---|
| `schedules/{uid}, schedules/{uid}/overrides/{date}` | Behavioural (availability pattern) | 96-slot weekly grid + per-date overrides. |
| `notifications/{notifId}` | Direct (`title, body` may contain names + amounts) | Per-recipient; deleted at 30 days. |
| `inviteLinks/{token}` | Pseudonym (`familyId, createdByUserId, usedByUserId`) | Auto-deleted on expiry. |
| `verificationCodes/{email}` | Direct (`email` is the doc id) + transient secret (`code`) | 10-min TTL, auto-deleted. |
| `communityVerificationCodes/{code}` | Pseudonym + transient secret | 24-hour TTL, deleted after use. |
| `auditLogs/{id}` | Pseudonym (`adminUserId, targetUserId`) + variable detail bag | 30-day retention. |
| `preapprovedEmails/{email}` | Direct (`email` is the doc id) | Pre-enrollment allowlist. |
| `holidays/{schoolYear}` | none | Reference data. |
| `searches/{searchId}` | Direct (`address, latLng`) + Behavioural | Created by `sendContactRequest`. Not deleted by `cleanupOldData` — see [WATCH-7]. |
| `contactSharingRequests/{id}` | Direct (`familyName, parentName`) + linkage | Not in `cleanupOldData` retention — see [WATCH-7]. |

---

## 5. Secrets surface

| Secret | Used by | Provisioning | Where referenced | Notes |
|---|---|---|---|---|
| **Resend API key** | `sendVerificationEmail`, `sendNotificationEmail`, `sendAdminNotification` (all in `apps/functions/src/config/email.ts`) | `process.env.RESEND_API_KEY` (NOT `defineSecret` from `firebase-functions/params`) | `apps/functions/src/config/email.ts:4` | Read at first email send via `getResend()` lazy init. If unset, function logs and returns (no email sent). [WATCH-8] |
| **Firebase Admin SDK runtime credentials** | every function via `apps/functions/src/config/firebase.ts` | implicit via `initializeApp()` (no args) — uses the Cloud Functions runtime service account | `apps/functions/src/config/firebase.ts:6` (`initializeApp()` only) | Default service account `<project>@appspot.gserviceaccount.com` (or the new Functions 2nd-gen SA). Has full Firestore, Storage, and Auth admin via google.iam roles. **No service-account JSON is loaded from disk anywhere** — the runtime injects credentials. |
| **FCM credentials** | `sendPushNotification` (`config/push.ts`) | inherited from Firebase Admin (same SA as above) — `getMessaging(app)` | `apps/functions/src/config/push.ts:23` (`messaging.sendEachForMulticast`) | No separate FCM API key. |
| **Firebase Auth admin credentials** | `enrollBabysitter, enrollFamily, joinFamily, blockUser, deleteUser, resetUserPassword` | inherited from Firebase Admin | `apps/functions/src/config/firebase.ts:8` (`adminAuth = getAuth(app)`) | Used to create users, disable accounts, delete accounts, generate password-reset links. |
| **CORS allowed origins** | every callable | `getCorsOrigin()` returns `true` (allow-all) | `apps/functions/src/config/cors.ts:7` | Documented rationale at the call site: "the functions are protected by Firebase Auth, so CORS restriction provides minimal additional security." Acceptable for callables that explicitly check `request.auth`. |
| **Emulator bypass flag** | `email.ts` short-circuits sends to `console.log` | `process.env.FUNCTIONS_EMULATOR === 'true'` | `email.ts:25, 91, 134` | Expected — Firebase sets this in the local emulator. |

**No other env-var reads exist** — `grep -rn "process.env\." apps/functions/src/` returns only the four hits above (`RESEND_API_KEY` × 1, `FUNCTIONS_EMULATOR` × 3). `defineSecret`/`defineString`/`defineInt` from `firebase-functions/params` is not used anywhere.

---

## 6. GDPR posture

### 6.1 Region locking

Every callable, every Firestore trigger, and every scheduled function declares `region: 'europe-west1'` in its options object. Confirmed by reading every export. `firebase.json` does NOT set a default `functions.region` — it's per-function. `firebase.json` does set `functions.runtime: 'nodejs20'` and `functions.codebase: 'default'`. **No data leaves europe-west1** except through Resend (which transits to Resend's infrastructure) and FCM (Google APIs, region-implicit).

### 6.2 Data subject rights

**Export (DSR Art. 15):** `admin/exportUserData.ts`. **Admin-only — there is no user-facing self-export.** Returns a single JSON document containing:
- `users/{uid}` doc (full)
- `families/{familyId}` doc (full, if user is a parent)
- All `appointments` where `babysitterUserId == uid` ∪ `familyId == user.familyId` (deduplicated)
- All `notifications` where `recipientUserId == uid`
- All `auditLogs` where `targetUserId == uid` (does NOT include logs where the user is the actor — see [WATCH-9])
- Writes its own audit log entry on completion.

**What is NOT exported:** `references` where the user appears (as babysitter or submitter), `contactSharingRequests`, `searches` (created by the user), `schedules`, `verifications` documents pointing at this user, `families/{fid}/kids/*` subcollection. [WATCH-10]

**Erasure (DSR Art. 17):** `admin/deleteUser.ts`. **Admin-only.**
1. Anonymizes `appointments.babysitterUserId` to the literal string `'deleted'` (preserves the appointment record). Cancels any pending/confirmed appointments.
2. If parent and last parent in the family: cancels family-side pending/confirmed appointments, deletes `families/{familyId}/kids/*`, deletes `families/{familyId}` doc itself.
3. If parent and not last: removes uid from `parentIds[]`; family stays.
4. Deletes all `notifications.recipientUserId == uid`.
5. If babysitter: deletes `schedules/{uid}` and its `overrides` subcollection.
6. Deletes `users/{uid}`.
7. Deletes Firebase Auth account (catches `auth/user-not-found` as already-gone).
8. Writes audit log (which contains `email` in the details bag — see [WATCH-11]).
9. Sends admin email summarizing the action.

**What survives erasure:**
- `references/*` where `babysitterUserId == uid` or `submittedByUserId == uid` (rule allows reads to all auth users; deletion not handled). [BLOCK-LATER-3]
- `contactSharingRequests/*` involving the user.
- `searches/*` created by the user.
- `verifications/*` for the user's family if NOT last parent (family doc preserved → verifications doc presumably useful, but contains the user's `uploadedByUserId`).
- The audit-log entry created at deletion (`details.email = <user email>`) — [WATCH-11].
- The deletion entries written by `cleanupOldData` etc. retain only pseudonyms after their own 30-day window expires.

**`removeCoParent` is NOT a deletion path** — it leaves the user's account intact, just unlinks from the family.

### 6.3 Retention

`scheduled/cleanupOldData.ts`, daily 03:00 Europe/Paris:
- `notifications` — 30 days from `createdAt`
- `auditLogs` — 30 days from `timestamp`
- `inviteLinks` — immediate after `expiresAt` (links are single-use, 7-day TTL)
- `verificationCodes` — immediate after `expiresAt` (10-min TTL)
- `appointments` with `status in [cancelled, rejected]` AND `createdAt > 30 days ago` AND (`date` empty OR `date < 7 days ago`)
- All queries capped at 500/run; one-shot batch per query (no pagination yet — at the current scale this is sufficient).

**Not on a retention schedule:**
- `users` (kept indefinitely until admin DSR-deletes)
- `families`, `families/*/kids`
- `schedules`
- `verifications` (the metadata; the underlying Storage objects in `verification-documents/{familyId}/*` also have **no lifecycle policy** that I can see)
- `references`
- `contactSharingRequests`
- `searches`
- `communityVerificationCodes` (24-hour TTL but no scheduled cleanup — unused codes accumulate; this is `[WATCH-7]`)
- `holidays`, `preapprovedEmails`

The 30-day audit-log retention is short relative to typical incident-response windows (90 days is more common). [WATCH-12]

### 6.4 Data flows (the matrix every later phase must check)

| Source collection | Sink collection / channel | Function | Direction |
|---|---|---|---|
| `families.familyName, .photoUrl, .pets, .note` | `appointments` (denormalized) | `sendContactRequest` | within-tenant |
| `families/kids/*.age, .languages` | `appointments.kids[]` | `sendContactRequest`, `modifyAppointment`, `resubmitAppointment` | within-tenant (kid name dropped) |
| `users` (parent) `.firstName, .lastName, .email, .phone, .whatsapp` | callable response payload to babysitter | `getParentContacts` | **cross-party** — babysitter sees parent contact info |
| `users` (babysitter) `.contactEmail, .contactPhone` | callable response payload to parent | `searchBabysitters` (gated on `approvedFamilies`) | **cross-party** — parent sees babysitter contact info |
| `users` (any) `.email` | Resend SMTP | `sendVerificationEmail, sendNotificationEmail, sendAdminNotification` | egress to third-party processor |
| `users` (any) `.fcmTokens[]` | Google FCM | `sendPushNotification` | egress to Google FCM |
| `users.email` (admin) | callable response | `resetUserPassword` (returns reset link by email param) | within-app |
| `verifications.fileUrl` | Storage signed URL | `getVerificationDocument` | within-tenant (15-min TTL) |
| `users` doc (full) | callable response | `exportUserData` | DSR — admin-mediated |

**No cross-app data flow exists today** — sync-sit is the only consumer. This is the line. Phases 2–4 introduce sync-study; every new arrow on this matrix is a phase-review item.

### 6.5 Lawful basis & consent (out of scope, briefly noted)

- `enrollBabysitter` requires `consentVersion` and writes `consentAt + consentVersion` to the user doc.
- `enrollFamily` writes `consentVersion: '1.0'` (hard-coded — does not require it from the client). [WATCH-13]
- `joinFamily` does NOT capture consent at all — second-parent invitee never records `consentAt/consentVersion`. [WATCH-14]
- No granular consent UI for individual processing purposes — consent is single-version, take-it-or-leave-it.

These are product/legal concerns and out of Agent 9's scope to fix; flagged so later phases don't unknowingly introduce new processing without revisiting consent.

---

## 7. Findings carried into Phase 1+

Each item is tagged. None block Phase 0 (this is the baseline; the codebase ships today). Tags set the bar that later phases must not regress past, and `[BLOCK-LATER-*]` items are slated for explicit remediation by the responsible agent in the relevant phase. `[WORKING-AS-INTENDED-*]` items were initially raised as findings but downgraded after explicit product-owner review or factual correction — they remain in the document so that any future change which contradicts the recorded design intent (or re-introduces a non-finding as a finding) surfaces as a regression in the next phase review.

### Baseline corrections log

This baseline is a living document; corrections to original entries are recorded here so auditors have a clean signal about doc fidelity over time. Each row names the affected entry, the correction date, and the replacement entry (if any).

| Date | Affected entry | Correction |
|---|---|---|
| 2026-05-15 | `[WATCH-15]` (original) — claimed no `@firebase/rules-unit-testing` harness existed for `firestore.rules` | **Withdrawn.** Replaced by `[WORKING-AS-INTENDED-2]` below. Original entry was a baseline-author oversight: the `tests/rules/` directory (containing `firestore-rules.test.ts` with 13 tests and `storage-rules.test.ts` with 18 tests, 31 tests total) was not searched for during the Phase 0 source inventory. Both the original Phase 0 baseline (`d4a809b`) and the Phase -1 security-fix review (`72c882d`) accepted the absence-claim without independent verification. The harness exists, runs in CI, and caught a real bug in security-fix's references-update rule on PR #43 (hotfix at commit `79215fd`, cherry-picked from `f8fa47f`). Process improvement is recorded in §8 item 6. |

### `[BLOCK-LATER-1]` — `families` doc has no field-level write guard

**Where:** `firestore.rules:43` — `allow update: if isFamilyMember(familyId);`
**Impact:** A family member can use the client SDK to write `verification.isFullyVerified=true`, `verification.isEjmFamily=true`, mutate `parentIds[]`, change `searchDefaults`, or alter any other field — bypassing `submitVerification`, `reviewVerification`, `approveCommunityCode`, `joinFamily`, and `removeCoParent`. **`searchBabysitters` then trusts `verification.isFullyVerified` as its sole gate to allow babysitter contact.**
**Why this is here, not blocked at Phase 0:** The codebase ships today and the bar is "no regression." Sync-sit has shipped with this. But Phase 4 (Agent 6 — firestore.rules update) is the natural moment to add the field-level guard. **Agent 9 will require this fix at Phase 4 review** unless an explicit decision is made to keep the current posture.

### `[BLOCK-LATER-2]` — `users` doc owner-update doesn't block `approvedFamilies`

**Where:** `firestore.rules:34-36` — the `affectedKeys()` blocklist covers `role,status,uid,email,ejemEmail,createdAt` only.
**Impact:** A babysitter can overwrite their own `approvedFamilies[]` via the client SDK to grant or revoke contact-sharing arbitrarily. The data exposure is limited (only the babysitter's own `contactEmail`/`contactPhone` is at stake, and only to families that exist), but it bypasses the `respondToContactSharing` callable's GDPR audit-trail (no `auditLogs` entry is written, no `contactSharingRequests` doc is mutated). Per-family consent state is the source of truth for the consent record; allowing direct writes to `approvedFamilies` decouples the consent UI from the consent log.
**Decision for Phase 4:** Add `approvedFamilies` to the `affectedKeys()` blocklist so all mutations route through `respondToContactSharing` (which writes the audit log).
**History:** This entry originally also covered `users.searchable`. The `searchable` half was downgraded to `[WORKING-AS-INTENDED-1]` after product-owner triage on 2026-05-15 — see that entry below.

### `[WORKING-AS-INTENDED-1]` — `users.searchable` is intentionally owner-writable

**Where:** `firestore.rules:34-36` — `searchable` is deliberately absent from the `affectedKeys()` blocklist.
**Original concern (Phase 0 baseline draft):** A babysitter can flip their own `searchable: true` after admin's `deactivateUser` set it false — appearing to undo an admin enforcement action via direct client write.
**Product-owner decision (2026-05-15):** Working as intended. The product design is:
- `users.searchable` is the **babysitter's own visibility toggle** (self-managed from their dashboard — "show me in search results / hide me").
- `users.status` is the **hard enforcement gate** (`active | blocked`). `status` IS in the blocklist (line 36) and IS gated by admin-only callables (`blockUser`).
- `admin/deactivateUser` is therefore a **soft hide / nudge** to a babysitter, not an admin-enforced ban. If an admin needs to actually prevent a babysitter from being discoverable or from logging in, the correct lever is `blockUser` (which sets `status: 'blocked'` AND disables the Firebase Auth account).
**Why this stays in §7:** Recording the design intent so that any future PR which adds `searchable` to the blocklist (which would be a reasonable-looking "tightening" change) surfaces as a regression against the recorded product decision rather than a silent posture change. If product intent ever flips, this entry should be re-promoted to `[BLOCK-LATER-*]` and the `deactivateUser` semantics revisited at the same time.

### `[BLOCK-LATER-3]` — `references` rule lets any auth user create a reference about themselves

**Where:** `firestore.rules:81-84` — `allow create: if isAuth() && (request.resource.data.babysitterUserId == request.auth.uid || request.resource.data.submittedByUserId == request.auth.uid);`
**Impact:** A babysitter can write a `references/*` doc with `babysitterUserId == own-uid` and arbitrary `status, submittedByName, refName, ...` content — self-puffery. The babysitter cannot mark it `published` to surface it themselves only if a Cloud Function gates publish (no such function exists in current code; `searchBabysitters` reads `status in [approved, published]`). **This is a real fraud vector for ratings.**
**Decision:** Either move all reference creates to a callable (Cloud Function gates `submittedByUserId != babysitterUserId` and gates publish-state transitions) or tighten the rule to block self-creates. Worth raising at Phase 1.

### `[BLOCK-LATER-4]` — `references` rule allows any auth user to forge endorsements as themselves

**Where:** `firestore.rules:81-88` — the `submittedByUserId == request.auth.uid` branch allows User A to write an endorsement claiming they (A) are submitting an endorsement for any babysitter B. Combined with `searchBabysitters` reading `references where status in [approved, published]`, A can inflate B's `referenceCount`.
**Impact:** Same fraud-vector class as [BLOCK-LATER-3] — anyone can pump up any babysitter's reference count. Mitigated only by status filter (`approved | published`), but the rule allows the user to set status to `approved` directly on create.
**Decision:** Move all reference writes to a callable that validates the submitter's relationship to the babysitter (e.g. shared appointment history) and forces `status='pending'` on create.

### `[BLOCK-LATER-5]` — `references` create rule cannot verify submitter↔babysitter relationship

**Where:** `firestore.rules` — the `references` create rule (post-security-fix; lands in orchestration when `feature/sync-study-security-fix` merges).
**Origin:** Surfaced during the Phase -1 security-fix review (commit `72c882d`, `docs/agent-runs/agent-9-phase-minus-1-security-fix-review.md` §1 BL-3 verdict). Recorded here so the standing baseline carries the forward-looking finding.
**Impact:** The new create rule (commit `6ecbaf6`) closes the auth-into-search fraud vector by forcing `status='private'` on create and splitting create into a `'manual'` branch (babysitter records own offline reference) and a `'family_submitted'` branch (parent endorses a different babysitter). What it CANNOT express in Firestore-rule language is a relationship check between the submitter and the babysitter — there's no way to ask "does an `appointments` document exist where `babysitterUserId == new ref's babysitterUserId` AND `familyId == submitter's familyId` AND `status == 'confirmed'`?" inside a rule. Result: any authenticated parent can create a `family_submitted` reference about any babysitter they have never interacted with. The reference can contain spam or libelous content. The babysitter (target) can read it (every authenticated user can read every reference per [WATCH-3]) and can transition it to `status='removed'` per the new update rule.
**Mitigation in place:** Forced `status='private'` on create keeps the spam/libel content out of `searchBabysitters`'s result set (which filters `status in ['approved','published']`). The `references` collection is therefore not a public-amplification surface for the spam — only a private-direct-message surface to the targeted babysitter.
**Decision:** Move `references` create to a callable (`submitFamilyEndorsement` or similar) that validates the submitter's relationship via an `appointments` lookup before allowing the write. The callable must additionally enforce `status='pending'` (or `'private'`) on create, mirroring the rule. **Owner: Phase 1+ reference-flow work** (likely Agent 3 or whoever owns the references domain when sync-study extraction starts).

### `[BLOCK-LATER-6]` — No legitimate path exists to promote a manual reference to `'published'`

**Where:** `firestore.rules` — the `references` update rule (post-security-fix).
**Origin:** Surfaced during the Phase -1 security-fix review (commit `72c882d`, §1 BL-4 verdict). Recorded here for the standing baseline.
**Impact:** The new update rule (commit `1de176c`) restricts client-side status transitions to `'private'` or `'removed'` only. Promotion to `'approved'` or `'published'` (the two values `searchBabysitters` filters on) is denied from any client SDK path. **This is correct and intentional** — the previous client-side `publishReference()` flow at `apps/web/src/hooks/useEndorsements.ts:105` (called by `apps/web/src/pages/babysitter/EndorsementsPage.tsx:370,387`) WAS the [BLOCK-LATER-4] reference-count inflation fraud vector and was correctly killed at the rule layer. However the legitimate use-case (admin-approved or peer-approved manual-reference publish) currently has no path: no callable exists that mints `status='published'` server-side, and the client cannot do it. The babysitter's "Publish" button now silently fails until a replacement callable lands.
**Mitigation in flight:** A separate `feature/sync-study-ux-publish-hide` agent is removing the failing UI affordance so users don't click into silent failure. Agent 9 will alignment-check that branch when it lands (the check: does the UI hide accurately reflect the rule's intended kill — i.e., no remaining UI affordance for an action the rule denies). Tracked as Step C in the current task chain.
**Decision:** Add a `publishReference` callable that gates publish-state transitions on either an admin role check OR a peer-approval mechanism (e.g. another verified family confirms the manual reference is legitimate). Until that callable exists, the publish capability remains absent by design; manual references stay `'private'` indefinitely. **Owner: Phase 1+ reference-flow work**, paired with [BLOCK-LATER-5] (likely the same callable/refactor PR).

### `[WATCH-1]` — Admin role is checked via Firestore-roundtrip on every call

**Where:** `firestore.rules:17` (`isAdmin()` does `get(/databases/.../users/{uid}).data.role == 'admin'`) and `apps/functions/src/admin/verifyAdmin.ts:9-11`.
**Impact:** Every admin-rule check + every admin callable does a Firestore read just to confirm the role. With small admin counts this is cheap, but it's also a single point of failure: if Firestore is unavailable, admin functions throw `permission-denied` instead of failing open. More importantly, role assignment is a Firestore document write — a compromise of the runtime SA's Firestore admin permissions could mint admins silently.
**Recommendation:** Migrate to a Firebase Auth custom claim (`auth.token.admin == true`) for admin checks. Out of scope for sync-study extraction; flagging only.

### `[WATCH-2]` — `users` doc is owner-writable for fields that affect search results

**Where:** `firestore.rules:34-36` (covered above in [BLOCK-LATER-2] for `approvedFamilies` and in [WORKING-AS-INTENDED-1] for `searchable`). Listed here as a `[WATCH]` so per-phase reviews compare against the explicit blocklist — any future addition of an owner-writable field to `users/{uid}` that affects search ranking, contact gating, or visibility must add a row here.

### `[WATCH-3]` — `references` are world-readable across all authenticated users

**Where:** `firestore.rules:80` — `allow read: if isAuth();`
**Impact:** Every endorsement of every babysitter is readable by every signed-in user (including all babysitters reading each other's endorsements). Limited PII exposure (`refName, submittedByName, body`). Acceptable as "endorsements are public," but make sure no later phase adds private fields to `references` without tightening the rule.

### `[WATCH-4]` — Dead Firestore rule for `auditLog` (singular) vs actual `auditLogs` (plural)

**Where:** `firestore.rules:118-121` (rule on singular) vs every Cloud Function writing/reading `auditLogs` (plural — `writeAuditLog.ts:17`, `cleanupOldData.ts:45`, `listAuditLogs.ts:27`, `exportUserData.ts:65`).
**Impact:** The actual `auditLogs` collection has no rule and falls under the default-deny — which is the SAFE failure mode. Admins must call `listAuditLogs` callable. The dead `auditLog` rule confuses readers; could be deleted in Phase 4.

### `[WATCH-5]` — Storage `verification-documents/{familyId}/*` write rule has no familyId-membership check

**Where:** `storage.rules:7-9`.
**Impact:** Any authenticated user can upload to any `familyId/` subpath. The only writer in production is `submitVerification` (which uploads via the client and then writes the metadata doc), but a malicious client could overwrite or pollute another family's verification path. Reads are gated by `getVerificationDocument`, so the malicious file wouldn't be served to an unauthorized reader — but it could DoS the legitimate verification or cause confusion. Worth a Phase 4 tightening: `allow write: if request.auth != null && exists(/databases/(default)/documents/users/$(request.auth.uid)) && get(...).data.familyId == familyId;`

### `[WATCH-6]` — Storage `family-photos/**` is fully open to all authenticated users

**Where:** `storage.rules:20-23` — both `read` and `write` only require `request.auth != null`.
**Impact:** Any authenticated user can read OR overwrite any other family's photos. Combined with `families.photoUrl` being denormalized into `appointments.familyPhotoUrl` (returned via callables), a malicious user could replace a family photo with arbitrary content that then surfaces in babysitter dashboards. **Recommend tightening at Phase 4** (e.g., scope writes to `family-photos/{familyId}/...` and require family membership).

### `[WATCH-7]` — Several user-PII collections have no retention schedule

**Where:** `cleanupOldData.ts` covers only 5 collections. `searches`, `contactSharingRequests`, `communityVerificationCodes`, `verifications` (and the underlying Storage objects), and `references` accumulate without bound. The first three contain PII that the user did not consent to retain indefinitely.
**Impact:** GDPR data-minimization argument — slow drift toward "we kept everything." Sync-study will add `study-sessions` and `study-searches`; building a retention rule for those is the natural moment to revisit.

### `[WATCH-8]` — `RESEND_API_KEY` provisioned via `process.env`, not Functions Secrets

**Where:** `apps/functions/src/config/email.ts:4`.
**Impact:** The key is set at deploy time via the Functions environment config (or 1st-gen `functions.config()`). It is NOT in Google Secret Manager via `defineSecret('RESEND_API_KEY')`. The runtime env-var pathway works but lacks rotation without redeploy, audit logging on access, and per-function least-privilege binding.
**Recommendation:** Migrate to `defineSecret` at Phase 2 (when shared-functions takes ownership of email senders, per the project plan).

### `[WATCH-9]` — `exportUserData` only includes audit logs targeting the user, not by the user

**Where:** `admin/exportUserData.ts:64-67` — query is `where('targetUserId', '==', targetUserId)`.
**Impact:** A user is also a "data subject" for actions they themselves performed (the audit log includes `adminUserId == uid` for non-admin user activity, e.g. `community_code_generated`, `appointment_modified`). Those entries are not returned in their export.
**Recommendation:** Include `where('adminUserId', '==', uid)` UNION the existing query.

### `[WATCH-10]` — `exportUserData` omits several user-touching collections

**Where:** As above.
**Impact:** Missing from the export: `references` (where the user is babysitter or submitter), `contactSharingRequests`, `searches`, `verifications` for their family, `families/*/kids/*`, `schedules` (babysitters), `schedules/*/overrides/*`. None are exotic; all should be included for a real DSR Art. 15 response.

### `[WATCH-11]` — `deleteUser` writes the deleted user's email into the audit log

**Where:** `admin/deleteUser.ts:172-182` — `details: { role, email, ... }`.
**Impact:** The audit log retention is 30 days, so the email surfaces only briefly. But this means even after Art. 17 erasure, the user's email lingers in `auditLogs` for up to 30 days. Defensible for accountability, but worth documenting in the privacy notice. Not a fix — just must remain documented.

### `[WATCH-12]` — Audit-log retention of 30 days is short

**Where:** `cleanupOldData.ts:21-58` — `thirtyDaysAgo` cutoff.
**Impact:** Industry baseline for security audit logs is 90 days minimum (often 365 days for compliance). 30 days is a real gap if a slow-burn incident is discovered late.
**Recommendation:** Bump audit-log retention to 90 days at minimum. Not a phase-blocker for sync-study.

### `[WATCH-13]` — `enrollFamily` hard-codes `consentVersion: '1.0'`

**Where:** `apps/functions/src/enrollment/enrollFamily.ts:148`.
**Impact:** If consent text changes, families enrolled before the change carry an out-of-date `consentVersion`. The function itself doesn't ask the client what version they consented to.
**Recommendation:** Mirror `enrollBabysitter` (require `consentVersion` from the client).

### `[WATCH-14]` — `joinFamily` does NOT record consent for the joining co-parent

**Where:** `apps/functions/src/enrollment/joinFamily.ts:97-115` — no `consentAt` / `consentVersion` written.
**Impact:** Second-parent invitees never have a consent record. From a GDPR-defence perspective: weaker than the first parent.
**Recommendation:** Require + write `consentVersion` in `joinFamily` as well.

### `[WORKING-AS-INTENDED-2]` — Rules-test harness EXISTS at `tests/rules/` (corrects withdrawn `[WATCH-15]`)

**Where:** `tests/rules/firestore-rules.test.ts` (13 tests) and `tests/rules/storage-rules.test.ts` (18 tests). 31 tests total. Run via:
```
npx firebase-tools emulators:exec --project demo-test --only firestore,auth,storage \
  'pnpm --filter @ejm/tests exec vitest run rules/'
```
A fresh worktree must first run `pnpm install --filter "@ejm/tests..."` to populate the test workspace's `node_modules`.

**Origin:** Originally raised as `[WATCH-15]` in commit `d1004ee` based on the Phase -1 security-fix review's note-2 decision. **That entry was wrong.** The `tests/rules/` directory was not searched for during the Phase 0 source inventory; the security-fix review then accepted the absence-claim without independent verification; the WATCH-15 entry compounded the oversight by reporting the gap as a finding. All three documents (Phase 0 baseline, security-fix review, baseline amendment) were authored by the same reviewer (agent-9-security) and shared the same blind spot. The error was caught externally — by team-lead spotting the directory, and by the harness itself catching a real bug in security-fix's references-update rule on PR #43's CI run (an evaluation error when `submittedByUserId` was missing from a manual reference; hotfix at commit `79215fd`, cherry-picked from `f8fa47f`).

**Why this stays in §7 (instead of being deleted):** Recording the design intent so that any future PR which proposes "stand up a rules-test harness" surfaces against this entry — pointing the proposer at the existing harness rather than letting them duplicate work. Also: the corrections-log row at the top of §7 would lose its target if this entry vanished.

**What good looks like for future per-phase reviews:** Run the harness locally before marking PASS on any `firestore.rules` or `storage.rules` change. The harness invocation pattern is documented in `tests/rules/README.md` (if present) and in §8 item 6 below. Treat unrun-harness-on-rules-change as a process failure to be flagged, not as a content-quality gap.

### `[INFO]` — Profile-photo Storage prefix-equality check

**Where:** `storage.rules:14-17`. UIDs are 28 chars from `[A-Za-z0-9_-]`; prefix collisions are not realistic at any deployable scale. Documenting only so a later edit doesn't loosen the check further.

### `[INFO]` — CORS is open by design

**Where:** `apps/functions/src/config/cors.ts:7`. Acceptable because every callable explicitly checks `request.auth`. Documenting only so a future "tighten CORS" PR doesn't break legit callers.

---

## 8. Comparison checklist for later phases

Every per-phase review report (`agent-9-phase-N-review.md`) re-runs the following checks against this baseline:

1. **Auth check delta per affected function** — for each Cloud Function changed in the phase, confirm `request.auth` requirement and role/scope checks are unchanged or tightened. Any new function gets a row added to §2.
2. **Firestore rules delta per affected collection** — for each rule block touched, confirm read/write/field-level posture is unchanged or tightened. Any new collection gets a row added to §3.
3. **New PII fields introduced** — for each collection touched, list any new field that holds personal data and classify it per §4. Confirm minimization (e.g., why is the field needed?).
4. **New secrets / new use sites of existing secrets** — for each new external-service integration, confirm provisioning via `defineSecret`. For each new use site of an existing secret, confirm the use site is necessary.
5. **New cross-collection or cross-app data flow** — for each new write that copies data between collections or apps, add a row to §6.4 and confirm it does not introduce a new GDPR data-flow boundary that the privacy notice doesn't cover.
6. **Rules-test harness — required action when `firestore.rules` or `storage.rules` is touched.** Run `tests/rules/` locally BEFORE marking PASS on any rules-affecting change. Invocation:
   ```
   pnpm install --filter "@ejm/tests..."   # first time per worktree only
   npx firebase-tools emulators:exec --project demo-test --only firestore,auth,storage \
     'pnpm --filter @ejm/tests exec vitest run rules/'
   ```
   Expected baseline state: 31/31 pass (13 firestore + 18 storage). Any test that fails on a PR is a BLOCKED finding regardless of how clean the diff looks on inspection. **Lesson learned:** the original Phase -1 security-fix review (commit `72c882d`) marked PASS without running this harness and missed an evaluation-error bug in the references-update rule that CI then caught (hotfix `79215fd`, cherry-pick of `f8fa47f`). Manual file-by-file inspection of a rule change is necessary but NOT sufficient when the rule references possibly-absent fields (`'X' in resource.data` checks, optional fields, sparse-document collections like `references` where `submittedByUserId` is present in one branch and absent in another). The harness exercises both branches via synthetic auth contexts; reviewer-eye inspection often misses the absent-field edge.

Any item that fails these checks → BLOCKED status in the per-phase review.

---

**End of Phase 0 baseline. Status: PASS.** Next action: stand by for Phase 1 review trigger from coordinator.
