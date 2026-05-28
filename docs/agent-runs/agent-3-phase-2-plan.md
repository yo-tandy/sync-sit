# Agent-3 — Phase 2 Plan (Shared-Functions Extraction)

Owner: agent-3
Branch: `feature/sync-study-shared-functions`
Worktree: `/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-shared-functions`
Baseline: `95049cc` (main HEAD after Phase 1 + Phase 1.1 @source fix)
Status: plan-only; no code edits yet. Uncommitted at write time.

---

## 1. Goal and scope boundary

**Goal.** Extract every Cloud Function that is cross-app (auth, family enrollment, verification, admin, shared notification/email/push helpers) out of `apps/functions/src/` into a new workspace package `packages/shared-functions/`, so that sync-study's backend (Phase 3 agent-4 in `apps/study-functions/`) can `import { ... } from '@ejm/shared-functions'` instead of re-implementing the same gate logic. sync-sit's deploy must remain green at every step — no behaviour change, no auth-check change, no PII change.

**In scope (moves to `packages/shared-functions/`).** The 5 config helpers, the 3 auth callables, the 5 family-related enrollment callables, the 8 verification callables, and the 13 admin callables — 34 source files total. Plus the brand-new package shell (`package.json`, `tsconfig.json`, `tsconfig.cjs.json`, `src/index.ts`, sub-barrel index files).

**Out of scope (stays in `apps/functions/src/`).** Everything sync-sit-specific:
- `enrollment/enrollBabysitter.ts` (babysitter-only)
- All of `search/` (searchBabysitters, sendContactRequest)
- All of `family/` (preferred-babysitter management, contact-sharing response, lookupBabysitter)
- All of `appointments/` (respondToRequest, cancelAppointment, modifyAppointment, acknowledgeModification, getParentContacts, resubmitAppointment)
- All of `references/` (onReferenceCreated firestore trigger — sync-sit-only data model for now)
- All of `scheduled/` (sendReminders, cleanupOldData — both reference sync-sit appointment shape)
- `admin/listAppointments.ts` and `admin/deleteAppointment.ts` (sync-sit appointment shape)

These files MUST keep working — they will rewire their imports from `../config/firebase.js` → `@ejm/shared-functions` (specifically the config + audit-log + verifyAdmin subpaths) once those helpers move.

**New packages created.** Exactly one: `packages/shared-functions/`. No code goes into a sync-sit-only intermediate or any new `apps/` directory in this phase. The package depends on `firebase-functions`, `firebase-admin`, and `@ejm/shared-core` (and indirectly on `@ejm/shared` for items not yet migrated to shared-core — see Risk Register R5).

---

## 2. Per-file migration order

Order is dictated by the internal import graph. The leaves (firebase init, cors, verifyAdmin, writeAuditLog) are extracted first; the composers that import them come after. Every row obeys the §7 "copy-then-re-export" rule: the new file lands in `packages/shared-functions/src/...`, then the original file in `apps/functions/src/...` is replaced with a one-line `export * from '@ejm/shared-functions/...js';` re-export (or deleted entirely if not referenced by another non-extracted file). Each row runs `pnpm typecheck && pnpm build:functions` before moving on.

The dependency graph found in code (verified by grepping `^import` over all 34 files):

```
firebase.ts (leaf)
  └─ cors.ts (leaf)
  └─ email.ts → uses Resend; pulls process.env
  └─ push.ts → imports firebase.ts
  └─ writeAuditLog.ts → imports firebase.ts   (admin/, but USED by auth + enrollment + verification + sync-sit search/appointments)
  └─ verifyAdmin.ts → imports firebase.ts     (admin/, USED by every admin callable AND by verification reviewVerification + listPendingVerifications)
  └─ notifyParents.ts → imports firebase.ts + email.ts + push.ts
       │
       ├── auth/* (3) → firebase, cors, email, writeAuditLog, @ejm/shared validateEjmEmail
       ├── enrollment/{enrollFamily,joinFamily,...} (5) → firebase, cors, writeAuditLog, @ejm/shared schemas
       ├── verification/* (8) → firebase, cors, verifyAdmin, writeAuditLog, email (sendAdminNotification), storage signed URLs
       └── admin/* (13) → firebase, cors, verifyAdmin, writeAuditLog, email
```

### 2.1 Config (Step 1–5)

| # | Source | Destination | Depends on | Used by (post-extraction) |
|---|---|---|---|---|
| 1 | `apps/functions/src/config/firebase.ts` | `packages/shared-functions/src/config/firebase.ts` | `firebase-admin/{app,firestore,auth,messaging}` | EVERYTHING — must export `db`, `adminAuth`, `messaging` as named singletons (same names) so consumer import sites are unchanged. |
| 2 | `apps/functions/src/config/cors.ts` | `packages/shared-functions/src/config/cors.ts` | (none) | every callable |
| 3 | `apps/functions/src/config/email.ts` | `packages/shared-functions/src/config/email.ts` | `resend` (lazy require), `process.env.RESEND_API_KEY`, `process.env.FUNCTIONS_EMULATOR` | auth, verification (sendAdminNotification), admin/deleteUser, sync-sit appointments + scheduled + references + family + search |
| 4 | `apps/functions/src/config/push.ts` | `packages/shared-functions/src/config/push.ts` | `firebase.ts` (db, messaging), `firebase-admin/firestore` FieldValue | sync-sit appointments + scheduled + references + family + search; not strictly required by auth/enrollment/verification/admin but trivially co-located |
| 5 | `apps/functions/src/config/notifyParents.ts` | `packages/shared-functions/src/config/notifyParents.ts` | `firebase.ts` (db), `email.ts`, `push.ts` | sync-sit appointments only (respondToRequest, cancelAppointment, modifyAppointment, acknowledgeModification, resubmitAppointment, deleteAppointment). Extracted nonetheless — agent-4 (sync-study sessions) will reuse the exact same fan-out pattern for tutoring session events. |

After Step 5: replace the 5 `apps/functions/src/config/*.ts` files with re-exports (`export * from '@ejm/shared-functions/config/firebase.js';` etc.), so every existing `import { db } from '../config/firebase.js'` in unmigrated files keeps working unchanged. Run `pnpm typecheck && pnpm build:functions`.

### 2.2 Admin leaves (Step 6–7) — extracted BEFORE auth because auth depends on them

| # | Source | Destination | Depends on | Used by |
|---|---|---|---|---|
| 6 | `apps/functions/src/admin/writeAuditLog.ts` | `packages/shared-functions/src/admin/writeAuditLog.ts` | `firebase.ts` + `firebase-admin/firestore` FieldValue | **Critical leaf — imported by auth/verifyEjmEmail, auth/verifyParentEmail, enrollment/enrollFamily, enrollment/joinFamily, enrollment/removeCoParent, every admin callable, every verification callable except getVerificationStatus + listPendingVerifications + getVerificationDocument + lookupCommunityCode, and sync-sit search/appointments.** Export both `writeAuditLog` and `writeUserActivity`. |
| 7 | `apps/functions/src/admin/verifyAdmin.ts` | `packages/shared-functions/src/admin/verifyAdmin.ts` | `firebase.ts` (db), `firebase-functions/v2/https` HttpsError | every admin callable + verification/reviewVerification + verification/listPendingVerifications. **Security-binding** — see §7 R1 and §8 binding 2.9. |

Replace originals with re-exports. Typecheck + build.

### 2.3 Auth callables (Step 8–10)

| # | Source | Destination | Depends on | Notes |
|---|---|---|---|---|
| 8 | `apps/functions/src/auth/verifyEjmEmail.ts` | `packages/shared-functions/src/auth/verifyEjmEmail.ts` | firebase, cors, email (sendVerificationEmail), writeAuditLog (writeUserActivity), `@ejm/shared` validateEjmEmail, `crypto` | **Security-binding** — preserves: pre-approved-email branch (skips EJM domain check IFF `preapprovedEmails/{email}.used == false`), code = `crypto.randomInt(100000,999999)`, 10-min TTL, attempts=0 init, account-exists check. No `request.auth` requirement. |
| 9 | `apps/functions/src/auth/verifyParentEmail.ts` | `packages/shared-functions/src/auth/verifyParentEmail.ts` | firebase, cors, email, writeAuditLog, `crypto` | **Security-binding** — basic email regex only (any domain). Same code/TTL/attempts. No `request.auth` requirement. |
| 10 | `apps/functions/src/auth/verifyCode.ts` | `packages/shared-functions/src/auth/verifyCode.ts` | firebase, cors, `firebase-admin/firestore` FieldValue | **Security-binding** — preserves MAX_ATTEMPTS=5, expiry check via Firestore Timestamp `.toDate()`, increment-on-miss, no state mutation on success. |

Originals → re-exports.

### 2.4 Enrollment (family-related) (Step 11–15)

| # | Source | Destination | Depends on | Notes |
|---|---|---|---|---|
| 11 | `apps/functions/src/enrollment/generateInviteLink.ts` | `packages/shared-functions/src/enrollment/generateInviteLink.ts` | firebase, cors, `crypto` | Auth required; caller uid in `families/{familyId}.parentIds`. 32-byte hex token, 7-day TTL. |
| 12 | `apps/functions/src/enrollment/validateInviteLink.ts` | `packages/shared-functions/src/enrollment/validateInviteLink.ts` | firebase, cors | **Public proxy** — no auth. Returns ONLY `familyName`. Preserve verbatim — see R3. |
| 13 | `apps/functions/src/enrollment/enrollFamily.ts` | `packages/shared-functions/src/enrollment/enrollFamily.ts` | firebase (db, adminAuth), cors, writeAuditLog, `@ejm/shared` familyEnrollmentSchema | Creates auth user + `users/{uid}` + `families/{familyId}` + `kids/*`. Re-validates verification code. **PII boundary** — see §8. |
| 14 | `apps/functions/src/enrollment/joinFamily.ts` | `packages/shared-functions/src/enrollment/joinFamily.ts` | firebase (db, adminAuth), cors, `firebase-admin/firestore` FieldValue, writeAuditLog, `@ejm/shared` joinFamilySchema | Adds new auth user to existing family. Re-validates token + code. |
| 15 | `apps/functions/src/enrollment/removeCoParent.ts` | `packages/shared-functions/src/enrollment/removeCoParent.ts` | firebase, cors, `firebase-admin/firestore` FieldValue, writeAuditLog | Caller `role=='parent'`, must share family. Cannot remove self. Does NOT delete target's auth account. |

Originals → re-exports. (`enrollBabysitter.ts` is NOT touched — stays in apps/functions, but its `../config/firebase.js` and `../admin/writeAuditLog.js` imports now point at re-export shims that delegate to `@ejm/shared-functions`.)

### 2.5 Verification (Step 16–23)

| # | Source | Destination | Depends on | Notes |
|---|---|---|---|---|
| 16 | `apps/functions/src/verification/submitVerification.ts` | `packages/shared-functions/src/verification/submitVerification.ts` | firebase, cors, writeAuditLog (writeUserActivity), email (sendAdminNotification) | Caller `role=='parent'` with `familyId`. Deletes existing same-type verifications first. Notifies admin via email. |
| 17 | `apps/functions/src/verification/reviewVerification.ts` | `packages/shared-functions/src/verification/reviewVerification.ts` | firebase, cors, verifyAdmin, writeAuditLog | **Admin-gated**. Recomputes `families.verification.{identityStatus, enrollmentStatus, isFullyVerified, isEjmFamily}`. |
| 18 | `apps/functions/src/verification/listPendingVerifications.ts` | `packages/shared-functions/src/verification/listPendingVerifications.ts` | firebase, cors, verifyAdmin | Admin-gated. Returns enriched family + parent names. |
| 19 | `apps/functions/src/verification/getVerificationStatus.ts` | `packages/shared-functions/src/verification/getVerificationStatus.ts` | firebase, cors | Caller `role=='parent'` with `familyId`. Own family only. |
| 20 | `apps/functions/src/verification/generateCommunityCode.ts` | `packages/shared-functions/src/verification/generateCommunityCode.ts` | firebase, cors, writeAuditLog (writeUserActivity), `crypto` | Caller `role=='parent'` with `familyId`. Family NOT already `isFullyVerified`. 6-char alphanumeric, 24h TTL. |
| 21 | `apps/functions/src/verification/lookupCommunityCode.ts` | `packages/shared-functions/src/verification/lookupCommunityCode.ts` | firebase, cors | Caller gated by `isFullyVerified` + `isEjmFamily`. Self-approval blocked. **Read-only.** |
| 22 | `apps/functions/src/verification/approveCommunityCode.ts` | `packages/shared-functions/src/verification/approveCommunityCode.ts` | firebase, cors, writeAuditLog (writeUserActivity) | Same gating as lookup. Marks code used. Sets target family `isFullyVerified=true`. **Bypasses admin review** — preserve exact gate logic. |
| 23 | `apps/functions/src/verification/getVerificationDocument.ts` | `packages/shared-functions/src/verification/getVerificationDocument.ts` | firebase, cors, `firebase-admin/storage` getStorage | Caller is admin OR parent with `familyId == path.familyId`. 15-min signed URL. **Only legitimate read path for verification documents** — preserve verbatim. |

Originals → re-exports.

### 2.6 Admin (Step 24–34)

| # | Source | Destination | Depends on | Notes |
|---|---|---|---|---|
| 24 | `apps/functions/src/admin/getAdminDashboard.ts` | `packages/shared-functions/src/admin/getAdminDashboard.ts` | firebase, cors, verifyAdmin | Counts. |
| 25 | `apps/functions/src/admin/listUsers.ts` | `packages/shared-functions/src/admin/listUsers.ts` | firebase, cors, verifyAdmin | In-memory search. Up to 500 then filter. |
| 26 | `apps/functions/src/admin/blockUser.ts` | `packages/shared-functions/src/admin/blockUser.ts` | firebase (db, adminAuth), cors, verifyAdmin, writeAuditLog | Toggles `users.status` + `adminAuth.updateUser(disabled)`. |
| 27 | `apps/functions/src/admin/deleteUser.ts` | `packages/shared-functions/src/admin/deleteUser.ts` | firebase (db, adminAuth), cors, verifyAdmin, writeAuditLog, email (sendAdminNotification) | **GDPR hard-delete** — see §8 binding 6 for the trace this preserves. |
| 28 | `apps/functions/src/admin/resetUserPassword.ts` | `packages/shared-functions/src/admin/resetUserPassword.ts` | firebase (db, adminAuth), cors, verifyAdmin, writeAuditLog | Returns password-reset link. |
| 29 | `apps/functions/src/admin/updateHolidays.ts` | `packages/shared-functions/src/admin/updateHolidays.ts` | firebase, cors, `firebase-admin/firestore` FieldValue, verifyAdmin, writeAuditLog | Writes `holidays/{schoolYear}`. |
| 30 | `apps/functions/src/admin/listAuditLogs.ts` | `packages/shared-functions/src/admin/listAuditLogs.ts` | firebase, cors, verifyAdmin | Pageable. Enriched. |
| 31 | `apps/functions/src/admin/exportUserData.ts` | `packages/shared-functions/src/admin/exportUserData.ts` | firebase, cors, verifyAdmin, writeAuditLog | **GDPR DSR** — see §8 binding 4. |
| 32 | `apps/functions/src/admin/deactivateUser.ts` | `packages/shared-functions/src/admin/deactivateUser.ts` | firebase, cors, verifyAdmin, writeAuditLog | Toggles `users.searchable` for babysitters only. |
| 33 | `apps/functions/src/admin/managePreapprovedEmails.ts` | `packages/shared-functions/src/admin/managePreapprovedEmails.ts` | firebase, cors, verifyAdmin | Exports three callables: `addPreapprovedEmail`, `removePreapprovedEmail`, `listPreapprovedEmails`. |
| 34 | (no source — barrel) | `packages/shared-functions/src/index.ts` | all the above | Final barrel — see §3.4. |

Originals → re-exports. (`listAppointments.ts` and `deleteAppointment.ts` are NOT extracted — sync-sit appointment shape.)

---

## 3. Package shell setup

### 3.1 `packages/shared-functions/package.json`

Modeled exactly on `packages/shared-core/package.json` (so the `exports` field allows `from-source` consumption via the `import` condition AND `from-dist` via `require` for Firebase deploy):

```json
{
  "name": "@ejm/shared-functions",
  "version": "1.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "require": "./dist/index.js",
      "types": "./src/index.ts"
    },
    "./config/*.js": {
      "import": "./src/config/*.ts",
      "require": "./dist/config/*.js",
      "types": "./src/config/*.ts"
    },
    "./auth/*.js": {
      "import": "./src/auth/*.ts",
      "require": "./dist/auth/*.js",
      "types": "./src/auth/*.ts"
    },
    "./enrollment/*.js": {
      "import": "./src/enrollment/*.ts",
      "require": "./dist/enrollment/*.js",
      "types": "./src/enrollment/*.ts"
    },
    "./verification/*.js": {
      "import": "./src/verification/*.ts",
      "require": "./dist/verification/*.ts",
      "types": "./src/verification/*.ts"
    },
    "./admin/*.js": {
      "import": "./src/admin/*.ts",
      "require": "./dist/admin/*.js",
      "types": "./src/admin/*.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.cjs.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ejm/shared-core": "workspace:*",
    "@ejm/shared": "workspace:*",
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0",
    "resend": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^6.0.2"
  }
}
```

Notes:
- `@ejm/shared` is included because validateEjmEmail, familyEnrollmentSchema, and joinFamilySchema currently live in `packages/shared/` (not yet migrated to `shared-core` per Phase 1's deferred items — see R5). If those three names are confirmed available from `@ejm/shared-core` at executor time, drop `@ejm/shared` and re-point the imports.
- `resend` is a direct dep because `config/email.ts` does `require('resend')`. Lazy require — production OK.
- No test script for Phase 2. Vitest tests for these functions are agent-8 territory in Phase 4.

### 3.2 `packages/shared-functions/tsconfig.json` (typecheck-only, src-rooted, NoEmit)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

### 3.3 `packages/shared-functions/tsconfig.cjs.json` (build target — CJS for Cloud Functions)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "CommonJS",
    "moduleResolution": "node10",
    "ignoreDeprecations": "6.0",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true
  },
  "include": ["src"],
  "exclude": ["src/**/__tests__"]
}
```

Mirrors `packages/shared-core/tsconfig.cjs.json` exactly. CJS module output is mandatory because `apps/functions` builds with `module: CommonJS`.

### 3.4 `packages/shared-functions/src/index.ts` — root barrel

```ts
// Config (shared backend infrastructure)
export * from './config/firebase.js';
export * from './config/cors.js';
export * from './config/email.js';
export * from './config/push.js';
export * from './config/notifyParents.js';

// Admin leaves used cross-module
export * from './admin/writeAuditLog.js';
export * from './admin/verifyAdmin.js';

// Callables — auth
export { verifyEjmEmail } from './auth/verifyEjmEmail.js';
export { verifyParentEmail } from './auth/verifyParentEmail.js';
export { verifyCode } from './auth/verifyCode.js';

// Callables — enrollment (family-related only)
export { enrollFamily } from './enrollment/enrollFamily.js';
export { generateInviteLink } from './enrollment/generateInviteLink.js';
export { joinFamily } from './enrollment/joinFamily.js';
export { validateInviteLink } from './enrollment/validateInviteLink.js';
export { removeCoParent } from './enrollment/removeCoParent.js';

// Callables — verification
export { submitVerification } from './verification/submitVerification.js';
export { reviewVerification } from './verification/reviewVerification.js';
export { listPendingVerifications } from './verification/listPendingVerifications.js';
export { getVerificationStatus } from './verification/getVerificationStatus.js';
export { generateCommunityCode } from './verification/generateCommunityCode.js';
export { lookupCommunityCode } from './verification/lookupCommunityCode.js';
export { approveCommunityCode } from './verification/approveCommunityCode.js';
export { getVerificationDocument } from './verification/getVerificationDocument.js';

// Callables — admin
export { getAdminDashboard } from './admin/getAdminDashboard.js';
export { listUsers } from './admin/listUsers.js';
export { blockUser } from './admin/blockUser.js';
export { deleteUser } from './admin/deleteUser.js';
export { resetUserPassword } from './admin/resetUserPassword.js';
export { updateHolidays } from './admin/updateHolidays.js';
export { listAuditLogs } from './admin/listAuditLogs.js';
export { exportUserData } from './admin/exportUserData.js';
export { deactivateUser } from './admin/deactivateUser.js';
export {
  addPreapprovedEmail,
  removePreapprovedEmail,
  listPreapprovedEmails,
} from './admin/managePreapprovedEmails.js';
```

### 3.5 Root `pnpm-workspace.yaml` and root `package.json`

`pnpm-workspace.yaml` should already include `packages/*` — verify it does. If `package.json` has a `build:functions` script that explicitly lists shared packages to build first, append shared-functions to that list. Otherwise add a turbo/script pipeline entry so that `pnpm --filter functions build` causes `@ejm/shared-functions` to build first via `dependsOn` (CI's already-merged Phase 1.1 fix builds `packages/**` before any app typecheck — that covers shared-functions for free as soon as it lives under `packages/`).

### 3.6 Deploy bundler — `scripts/bundle-shared-for-deploy.js`

The current script bundles only `@ejm/shared` into `apps/functions/shared-bundle/` and rewrites `package.json` to use `file:./shared-bundle`. After Phase 2, `apps/functions` will also depend on `@ejm/shared-functions` (transitively, via the re-exports). The script must be extended to:

1. Build `@ejm/shared-functions` (CJS).
2. Bundle it next to `shared-bundle` as `shared-functions-bundle/` (mirror the same structure: src/, dist/, package.json, tsconfig*.json).
3. Rewrite the `@ejm/shared-functions` dependency in `apps/functions/package.json` to `file:./shared-functions-bundle` for predeploy.
4. Also bundle `@ejm/shared-core` because `@ejm/shared-functions` declares it as a workspace dep (npm-during-deploy will not understand `workspace:*`).

Equivalent npm-resolution trick: copy all three (`shared-core`, `shared`, `shared-functions`) and rewrite their inter-package `workspace:*` refs in each copied `package.json` to mutual `file:` refs. The executor should write a small loop rather than three copy-paste blocks. **This is the only non-trivial integration outside the package shell.**

Add `apps/functions/package.json` `dependencies`: `"@ejm/shared-functions": "workspace:*"`.

---

## 4. `apps/functions/src/index.ts` rewiring (before/after)

**Before** (current — 38 callable + 1 trigger + 2 scheduled exports, each from a local file):

```ts
export { verifyEjmEmail } from './auth/verifyEjmEmail.js';
// ... 37 more lines all importing from './...js'
```

**After** (Phase 2 final): the file becomes a thin manifest that re-exports shared callables from `@ejm/shared-functions` and keeps sync-sit-specific callables as local imports. The Cloud Functions deployment system reads `index.ts` and registers every named export as a function — so the export *names* must stay identical.

```ts
// Shared — re-exported from @ejm/shared-functions
export {
  // Auth
  verifyEjmEmail,
  verifyParentEmail,
  verifyCode,
  // Enrollment (family-related)
  enrollFamily,
  generateInviteLink,
  joinFamily,
  validateInviteLink,
  removeCoParent,
  // Verification
  submitVerification,
  reviewVerification,
  listPendingVerifications,
  getVerificationStatus,
  generateCommunityCode,
  lookupCommunityCode,
  approveCommunityCode,
  getVerificationDocument,
  // Admin
  getAdminDashboard,
  listUsers,
  blockUser,
  deleteUser,
  resetUserPassword,
  updateHolidays,
  listAuditLogs,
  exportUserData,
  deactivateUser,
  addPreapprovedEmail,
  removePreapprovedEmail,
  listPreapprovedEmails,
} from '@ejm/shared-functions';

// Sync-sit-specific — stay in apps/functions
export { enrollBabysitter } from './enrollment/enrollBabysitter.js';
export { searchBabysitters } from './search/searchBabysitters.js';
export { sendContactRequest } from './search/sendContactRequest.js';
export { addPreferredBabysitter } from './family/addPreferredBabysitter.js';
export { removePreferredBabysitter } from './family/removePreferredBabysitter.js';
export { lookupBabysitter } from './family/lookupBabysitter.js';
export { respondToContactSharing } from './family/respondToContactSharing.js';
export { respondToRequest } from './appointments/respondToRequest.js';
export { cancelAppointment } from './appointments/cancelAppointment.js';
export { modifyAppointment } from './appointments/modifyAppointment.js';
export { acknowledgeModification } from './appointments/acknowledgeModification.js';
export { getParentContacts } from './appointments/getParentContacts.js';
export { resubmitAppointment } from './appointments/resubmitAppointment.js';
export { notifyOnNewReference } from './references/onReferenceCreated.js';
export { sendReminders } from './scheduled/sendReminders.js';
export { cleanupOldData } from './scheduled/cleanupOldData.js';
export { listAppointments } from './admin/listAppointments.js';
export { deleteAppointment } from './admin/deleteAppointment.js';
```

Functional-equivalence check: `git diff` the *export list* should be a re-ordering and re-grouping only — no name added, no name removed. This is the single most important diff to review post-merge.

The sync-sit-specific files in `apps/functions/src/{search,family,appointments,scheduled,references}/` AND `apps/functions/src/admin/{listAppointments,deleteAppointment}.ts` AND `apps/functions/src/enrollment/enrollBabysitter.ts` will need their `../config/...` and `../admin/{verifyAdmin,writeAuditLog}` imports updated to `@ejm/shared-functions` (or kept pointing at the local re-export shim files — both work). Recommendation: replace the local re-export shim files with deletion as the final Step 35 once nothing imports them. Until then, the shims are the safety net.

---

## 5. Per-file safety gate (the §7 cycle, applied)

Repeated identically for every one of the 34 file moves:

1. **Copy.** Copy file contents from `apps/functions/src/X.ts` → `packages/shared-functions/src/X.ts`.
2. **Adjust internal imports in the new copy.** Imports from `../config/firebase.js` become `../config/firebase.js` *within* shared-functions (same relative path works — directory structure mirrors). Imports from `../admin/writeAuditLog.js` become `../admin/writeAuditLog.js` *within* shared-functions. Imports from `@ejm/shared` (or `@ejm/shared-core`) remain unchanged.
3. **Re-export from origin.** Replace contents of `apps/functions/src/X.ts` with:
   ```ts
   export * from '@ejm/shared-functions/...../X.js';
   ```
   For named exports that aren't `export *`-friendly (e.g. a default export, though none of these 34 files use one), use explicit `export { name } from '...';`.
4. **Typecheck + build.**
   ```bash
   pnpm typecheck && pnpm build:functions
   ```
5. **On failure: revert this one file.** `git restore apps/functions/src/X.ts packages/shared-functions/src/X.ts` (or delete the new copy if it's a fresh file). sync-sit's tree must be green at the end of every step. **Do not stack failures.**

Special-case for Step 1 (firebase.ts): because `initializeApp()` must run exactly once per process, and the re-export wrapper still imports from the same module file, the singleton guarantee is preserved. (Confirm: `getFirestore(app)` returns the same instance regardless of how many times the module is required — firebase-admin's module-level singleton + Node's CJS module cache handle this. No double-init risk.)

After all 34 file moves: run the **phase verification gates** in §9.

---

## 6. Deferred-from-Phase-1 followups to fold in

### 6.1 `apps/functions/tsconfig.json` — flip `moduleResolution` to `"node16"`

From `docs/sync-study-status-2026-05-20.md` §"Apps/functions tsconfig — permanent fix deferred":

> Recommended option (ii): Flip `apps/functions/tsconfig.json` `moduleResolution` to `"node16"` — Agent 3 territory (apps/functions owner); makes it resolve from source via the `exports` field.

The current `apps/functions/tsconfig.json` uses `moduleResolution: "node"` (classic Node10). After Phase 2, `apps/functions` will import from THREE workspace packages (`@ejm/shared`, `@ejm/shared-core`, `@ejm/shared-functions`), all of which expose source-via-`exports`. With `"node"` resolution, the typecheck must wait on `dist/` to exist for all three; with `"node16"`, the `exports` field resolves directly to `.ts` source and the per-package `dist/` precondition disappears (still needed at *build* time, not at *typecheck* time).

**Fold-in step (Step 35 — after all 34 files extracted):**

1. Change `apps/functions/tsconfig.json`:
   - `"module": "Node16"` (CommonJS-compatible Node16 module emit)
   - `"moduleResolution": "node16"` (or `"NodeNext"` if other Phase 6 work uses that — confirm with team-lead)
2. Verify all `.js` import extensions in `apps/functions/src/**/*.ts` are present (Node16 requires explicit `.js` extension on relative imports). Current code already does this — every grep'd import ended in `.js`. Good.
3. Run `pnpm typecheck && pnpm build:functions`. Expect green.
4. CI fix from `bc6a15a` (pre-build `packages/**` before typecheck) becomes redundant for the typecheck step but still needed for the build step — leave the CI unchanged in this phase, document the redundancy for Agent 6 to clean up in Phase 6.

**Risk:** if `node16` resolution breaks any sync-sit consumer because of an undeclared `exports` subpath, revert and use the alternative (i) from the status doc (root script that builds packages first). **This is a low-risk fold-in; revert is one file.**

### 6.2 No other Phase 1 deferreds for Agent 3

Phase 1's other deferreds (the three components held back from shared-ui extraction; security carry-forwards BL-5 / BL-6 / community-publish callable) are Agents 2 and 9's territory, not 3's. The community-reference publish callable is sync-sit-specific and arrives in a later phase under Agent 9 spec.

---

## 7. Risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| **R1** | **Auth-function authorization check breakage.** Any line drop/edit in `verifyAdmin`, `verifyEjmEmail` (pre-approved branch), `verifyParentEmail` (email regex), `verifyCode` (MAX_ATTEMPTS, expiry, increment-on-miss), `enrollFamily`/`joinFamily` (code re-validation), or `getVerificationDocument` (caller-must-be-admin-OR-familyId-match) would create a security regression. | High | The copy step in §5 is byte-equivalent (no edits to function body). Only the import paths and the file header change. agent-9's post-Phase-2 review reads every extracted file diff with `git diff --word-diff` and asserts function bodies are byte-for-byte equal modulo header. Triple-sign: agent-8 emulator smoke tests the auth flow end-to-end. |
| **R2** | **`notifyParents` PII leak across apps.** `notifyAllParents` reads `families/{familyId}.parentIds`, fans out to `users/{parentId}.notifPrefs`, and writes `notifications/*`. If shared-functions ends up co-located with study-functions later, a sync-study session-cancellation callable could call notifyAllParents with a sync-study `familyId` and accidentally read sync-sit-shaped parent data. | Medium | notifyAllParents is data-shape-agnostic (it only reads `families.parentIds` and `users.notifPrefs.{category}` — both shared collection schemas under cross-app account model per §2 of project plan). No leak today — flag for agent-9 review post-merge. agent-4 (Phase 3) MUST use the same `category` enum (`'newRequest' \| 'confirmed' \| 'cancelled' \| 'reminders'`) — no app-specific category names that bypass the user's notifPrefs. |
| **R3** | **`validateInviteLink` PII-minimization regression.** Public-proxy callable. Currently returns ONLY `familyName`. A future "helpful" refactor (e.g. returning kid count) would be a PII regression. | High | The current §3 docstring says "Returns ONLY familyName". Add a comment block in the new shared-functions copy: `// PII-CRITICAL: response shape is intentionally minimal. Do not add fields without agent-9 GDPR review.` Preserve the response shape verbatim. |
| **R4** | **Cross-app collection writes — `schedules.appSource` not yet implemented.** Project plan §2 describes a future schema field tagging which app owns a schedule override. Phase 2's extracted functions don't touch `schedules` (sync-sit's `respondToRequest` does, but that stays in apps/functions). | Low for Phase 2 | Out of scope. Agent 4 (Phase 3) introduces `appSource`. No action in Phase 2. |
| **R5** | **`@ejm/shared` vs `@ejm/shared-core` source-of-truth ambiguity.** `validateEjmEmail`, `familyEnrollmentSchema`, `joinFamilySchema`, `strongPasswordSchema` may live in `@ejm/shared` OR `@ejm/shared-core` depending on Phase 1's actual migration state vs the planned migration table (project plan §5 step 16–17). | Medium | Executor must `grep -r "export.*familyEnrollmentSchema" packages/` BEFORE Step 13 to confirm which package re-exports it; import from whichever resolves. If both: prefer `@ejm/shared-core` (the long-term home). Document the choice in the commit message. |
| **R6** | **Re-export double-init.** Step 1 (firebase.ts) replaces the original with `export * from '@ejm/shared-functions/config/firebase.js'`. If for any reason both the new file AND the original are required by separate code paths, `initializeApp()` could be called twice. | Low | firebase-admin's `initializeApp()` throws on second call with the same default name unless `apps[0]` is reused. Node's CJS cache keys by *resolved file path* — re-export indirection collapses to the same canonical file. Verified pattern from Phase 1 (shared-core firestore init re-exports work the same way). |
| **R7** | **Bundle-deploy script gap.** `scripts/bundle-shared-for-deploy.js` knows only about `@ejm/shared`. Deploy will break the first time sync-sit production deploy runs after Phase 2 unless the script is extended (§3.6). | High for deploy, zero for emulator | Plan §3.6 mandates the bundler extension. Phase 2 verification gate §9.4 deploys to emulator only; production deploy must wait for the bundler PR. **Open question O3.** |
| **R8** | **Phase 2 + Phase 3 race on `apps/functions/package.json`.** Agent 4 (study-functions) does not touch apps/functions but does add `apps/study-functions/` which depends on `@ejm/shared-functions`. If Phase 3 begins before Phase 2 lands the package, Agent 4 blocks. | Low | Sequencing already enforced by project plan §8 ("Agent 4 depends on Agents 1+3"). No code action. |

---

## 8. Security baseline coverage matrix

For every binding mandate from `docs/agent-runs/agent-9-security-baseline.md` §2 (the auth model), the corresponding file in this plan that preserves it:

| Baseline mandate | Plan step (file) | How preserved |
|---|---|---|
| **2.1 verifyEjmEmail** — no auth, EJM-domain check, pre-approved bypass, 6-digit code, 10-min TTL, attempts=0 | Step 8 (`auth/verifyEjmEmail.ts`) | Byte-equivalent copy; pre-approved branch untouched. R1. |
| **2.1 verifyParentEmail** — no auth, basic email regex, any domain | Step 9 (`auth/verifyParentEmail.ts`) | Byte-equivalent copy. R1. |
| **2.1 verifyCode** — no auth, expiry check, MAX_ATTEMPTS=5, increment-on-miss, no state mutation on success | Step 10 (`auth/verifyCode.ts`) | Byte-equivalent copy. R1. |
| **2.2 enrollFamily** — code re-validation, password schema, consentVersion, creates auth + users + families + kids | Step 13 (`enrollment/enrollFamily.ts`) | Byte-equivalent copy. R1. |
| **2.2 generateInviteLink** — auth required, caller uid in families.parentIds, 32-byte hex, 7-day TTL | Step 11 (`enrollment/generateInviteLink.ts`) | Byte-equivalent copy. |
| **2.2 validateInviteLink** — no auth, returns ONLY familyName (public proxy) | Step 12 (`enrollment/validateInviteLink.ts`) | Byte-equivalent copy + PII-CRITICAL comment header. R3. |
| **2.2 joinFamily** — code re-validation, token exists+unused+unexpired, creates auth, joins family | Step 14 (`enrollment/joinFamily.ts`) | Byte-equivalent copy. R1. |
| **2.2 removeCoParent** — caller role=parent, shares family, cannot remove self, does NOT delete auth | Step 15 (`enrollment/removeCoParent.ts`) | Byte-equivalent copy. R1. |
| **2.6 submitVerification** — caller role=parent with familyId, delete-existing-same-type, admin email notify | Step 16 (`verification/submitVerification.ts`) | Byte-equivalent copy. |
| **2.6 reviewVerification** — verifyAdmin gate, recomputes 4 family verification fields, audit log | Step 17 (`verification/reviewVerification.ts`) | Byte-equivalent copy + verifyAdmin extracted as leaf in Step 7. |
| **2.6 listPendingVerifications** — verifyAdmin gate | Step 18 (`verification/listPendingVerifications.ts`) | Byte-equivalent copy + verifyAdmin from Step 7. |
| **2.6 getVerificationStatus** — caller role=parent with familyId, own family only | Step 19 (`verification/getVerificationStatus.ts`) | Byte-equivalent copy. R1. |
| **2.6 generateCommunityCode** — caller role=parent + familyId + NOT isFullyVerified, 6-char alphanumeric, 24h TTL | Step 20 (`verification/generateCommunityCode.ts`) | Byte-equivalent copy. |
| **2.6 lookupCommunityCode** — caller gated by isFullyVerified + isEjmFamily, self-approval blocked | Step 21 (`verification/lookupCommunityCode.ts`) | Byte-equivalent copy. R1. |
| **2.6 approveCommunityCode** — same gate as lookup, bypasses admin review for community-EJM families | Step 22 (`verification/approveCommunityCode.ts`) | Byte-equivalent copy. R1. |
| **2.6 getVerificationDocument** — caller is admin OR parent with familyId-match, 15-min signed URL | Step 23 (`verification/getVerificationDocument.ts`) | Byte-equivalent copy. R1 + R3 (only legitimate read path for verification storage). |
| **2.9 verifyAdmin pattern** — `if (!request.auth) throw 'unauthenticated'; await verifyAdmin(request.auth.uid)` at every admin callable | Steps 7 + 24–33 | verifyAdmin extracted as leaf; each admin callable's auth-check prologue stays byte-equivalent. |
| **2.9 deleteUser (GDPR hard-delete)** — anonymize appointments.babysitterUserId, delete notifications, schedule, kids, family doc (last parent), user doc, auth account | Step 27 (`admin/deleteUser.ts`) | Byte-equivalent copy. The trace order must not change — agent-9 will diff. |
| **2.9 exportUserData (GDPR DSR)** — fetch user doc, family doc, all appointments where user is babysitter or family-member, all notifications.recipientUserId == uid, all auditLogs.targetUserId == uid | Step 31 (`admin/exportUserData.ts`) | Byte-equivalent copy. Note [WATCH-9] and [WATCH-10] are not fixed in this phase (out of scope — agent-9 future ticket). |
| **2.9 blockUser** — toggles users.status + adminAuth.updateUser({disabled}) | Step 26 (`admin/blockUser.ts`) | Byte-equivalent copy. |

**Net coverage.** Every callable listed in baseline §2.1, §2.2, §2.6, §2.9 has a corresponding plan step and the "byte-equivalent" mandate. §2.3 (search), §2.4 (family), §2.5 (appointments), §2.7 (references), §2.8 (scheduled) are NOT extracted — they stay in apps/functions, untouched at the body level (only import paths update). §2.9 `listAppointments` and `deleteAppointment` also stay (sync-sit appointment shape).

---

## 9. Per-phase verification gates

After all 34 file extractions + index rewire + tsconfig flip (Steps 1–35), run these gates in order. Each must pass before the next runs.

### 9.1 Static gate

```bash
pnpm -r typecheck
pnpm -r build
pnpm -r lint
```

Expected: green across the workspace. The `-r` (recursive) flag forces `@ejm/shared`, `@ejm/shared-core`, `@ejm/shared-ui`, `@ejm/shared-functions`, `apps/functions`, `apps/web` (and any future `apps/study-functions`) — every package in the workspace — to typecheck/build/lint.

### 9.2 Functions-specific build gate

```bash
pnpm --filter functions build
ls apps/functions/dist/index.js
```

Confirms the production Cloud Functions bundle compiles after the re-export shims redirect to `@ejm/shared-functions`. Expected: dist/index.js exists, all 38 expected exports present.

Quick smoke:
```bash
node -e "const f = require('./apps/functions/dist/index.js'); console.log(Object.keys(f).sort().join('\n'));"
```

Should print the same 38 names as the pre-Phase-2 baseline.

### 9.3 Pre-deploy bundle gate

```bash
node scripts/bundle-shared-for-deploy.js
ls apps/functions/shared-bundle apps/functions/shared-functions-bundle apps/functions/shared-core-bundle 2>/dev/null
```

After §3.6's bundler extension lands, all three bundles must exist and `apps/functions/package.json` must reference them via `file:` paths. Revert the bundler changes before committing if this phase doesn't include them (then file a follow-up).

### 9.4 Emulator smoke test

Start the Firebase emulator:
```bash
pnpm --filter functions build
firebase emulators:start --only auth,firestore,functions,storage
```

Run all four target flows manually (or via the seeded test data in `apps/functions/seed-test-data.cjs`):

| Flow | Steps | Pass criteria |
|---|---|---|
| **(a) Auth — login** | (i) Fresh user calls `verifyEjmEmail` with a `@ejm.com` address. (ii) Read `verificationCodes/{email}.code` from Firestore emulator. (iii) Call `verifyCode` with the code. | (i) Response `{success:true}`. (ii) Doc exists with TTL ~10min, attempts=0. (iii) Returns `{valid:true}`. |
| **(b) Family enrollment** | (i) Call `verifyParentEmail` for a parent address. (ii) Call `enrollFamily` with the code, family name, one kid. | `users/{uid}.role=='parent'`, `families/{familyId}.parentIds=[uid]`, kid subcollection has 1 doc, verificationCode deleted. |
| **(c) Verification upload** | (i) Authenticate as a parent in family (b). (ii) Upload a placeholder file to `verification-documents/{familyId}/...` via Storage. (iii) Call `submitVerification` with the path. (iv) Authenticate as an admin (seeded). (v) Call `getVerificationDocument` with the path. | (iii) `verifications/{id}.status=='pending'`, `families.verification.identityStatus=='pending'`. (v) Returns a signed URL (host = `storage.googleapis.com` or `localhost:9199` in emulator); accessing it 200s within 15 min. |
| **(d) Admin dashboard — one action** | (i) Authenticate as admin. (ii) Call `getAdminDashboard`. (iii) Call `blockUser` against the parent from (b). (iv) Re-call `getAdminDashboard`. | (ii) Returns counts. (iii) `users/{parent}.status=='blocked'`, auth user `disabled:true`, audit log entry `action: 'user_blocked'`. (iv) Counts reflect block. |

If any of (a)–(d) fails, revert the entire branch to baseline `95049cc` and bisect via the per-step commits.

### 9.5 sync-sit regression smoke

Manually exercise (or hit via seeded data):

- `searchBabysitters` returns results (config/firebase + admin/writeAuditLog re-exports still work).
- `respondToRequest` (babysitter accepts an appointment) writes `schedules/{uid}/overrides/{date}` and notifies family (config/notifyParents re-export works).
- `sendReminders` scheduled function runs in the emulator (configured for europe-west1) — log shows fan-out.

If any of these fail: the local re-export shim files in `apps/functions/src/config/` or `apps/functions/src/admin/{verifyAdmin,writeAuditLog}.ts` have a wrong path. Re-check the `export * from '@ejm/shared-functions/...js'` strings.

### 9.6 Security baseline diff gate

```bash
git diff main -- 'packages/shared-functions/src/**/*.ts' 'apps/functions/src/**/*.ts'
```

Manually inspect: every change must be (a) a new file in shared-functions, (b) a re-export-only replacement in apps/functions, (c) an import-path rewrite in unmigrated apps/functions files, or (d) the tsconfig flip. Any algorithmic change in a callable body is a violation. **agent-9 will run this same diff and block merge on findings.**

---

## 10. Open questions for team-lead

1. **O1 — `@ejm/shared` re-export shape at Phase 2 cutover.** Phase 1's deferred items left `validateEjmEmail`, `familyEnrollmentSchema`, `joinFamilySchema`, `strongPasswordSchema` possibly in `@ejm/shared` and not `@ejm/shared-core`. Which should `shared-functions` import from? (R5.) Recommendation: import from whichever resolves; let agent-1 finish the migration in a later phase. If team-lead prefers correctness over speed, ask agent-1 to land the schema-migration commit before Phase 2 starts.

2. **O2 — Bundle-deploy script extension: this PR or a separate one?** §3.6 + R7. The extension is a single ~30-line refactor to `scripts/bundle-shared-for-deploy.js`. It is required for production deploy but not for emulator. Two options: (a) fold into the Phase 2 PR (one big commit); (b) ship Phase 2 emulator-green, separate PR for deploy fix before next production deploy. Recommendation: (a) — keeps Phase 2 atomic and lets agent-6 review the deploy flow in one place.

3. **O3 — `apps/functions/tsconfig.json` flip to `node16`: this PR or separate?** §6.1. The flip is one-line and low-risk, but if it breaks anything, Phase 2 ends up debugging tsconfig instead of extraction. Two options: (a) fold in at Step 35 as planned; (b) defer to Agent 6 in Phase 6. Recommendation: (a) — the executor is already touching apps/functions and the revert path is one file.

4. **O4 — `notifyParents.ts` ownership.** Extracted to shared-functions because Phase 3 (sync-study sessions) will reuse it, but its only Phase 2 callers are sync-sit appointment functions that STAY in apps/functions. Should this single file stay in apps/functions for now and be lifted later, OR move with the rest? Recommendation: move now — keeps the config/ directory atomic and the lift is trivial.

5. **O5 — `@ejm/shared-functions/admin/writeAuditLog.js` subpath visibility.** `writeAuditLog` is currently in `apps/functions/src/admin/` but is used by auth, enrollment, verification, AND sync-sit search/appointments. Should it live in `shared-functions/src/admin/` (matches current layout) or `shared-functions/src/audit/` (semantically clearer, but introduces a layout difference from apps/functions)? Recommendation: keep it in `admin/` for byte-equivalent paths and zero diff for unmigrated files.

---

## 11. Estimated execution scope

- **New files:** ~36 in `packages/shared-functions/` (34 source files + package.json + tsconfig + tsconfig.cjs + src/index.ts).
- **Modified files in `apps/functions/`:** ~38 (34 originals → re-export shims, plus `index.ts` rewire, plus `package.json` adds `@ejm/shared-functions` dep, plus `tsconfig.json` flip).
- **Modified files outside `apps/functions/`:** `scripts/bundle-shared-for-deploy.js` (~30 line diff), root `package.json` if `build:functions` ordering needs an explicit hint (likely 1 line).
- **Total touched:** ~75 files. Roughly 34 sequential `pnpm typecheck && pnpm build:functions` cycles (one per file in §2), then one final verification cycle for the tsconfig + bundler diff.
- **Estimated execution wall-clock:** 4–6 h focused work for the executor sub-agent, assuming clean runs. Add 1–2 h for emulator smoke if anything fails.

---

## 12. Skill stack invoked during planning

- `nodejs-backend-patterns` — applied to §2's module boundary (config / auth / enrollment / verification / admin). The leaf-vs-composer split and the firebase.ts singleton-preservation argument come from this skill's "split by IO boundary" pattern.
- `firebase-basics` — applied to §3.1's `firebase-admin` versioning, §3.3's CJS target, and the §5 special-case for `initializeApp()` singleton.
- `firebase-auth-basics` — applied to §8's R1 binding for verifyEjmEmail/verifyParentEmail/verifyCode + the verifyAdmin Firestore-roundtrip check.
- `firebase-firestore` — applied to §8's coverage matrix for every callable that touches `users`, `families`, `verifications`, `notifications`, `schedules`, `auditLogs`, `verificationCodes`, `preapprovedEmails`, `communityVerificationCodes`, `inviteLinks`, `appointments` — and §7 R2/R4 (cross-app collection patterns).
- baseline: `writing-plans` (this doc structure), `test-driven-development` (smoke tests in §9 ordered by isolation), `executing-plans` (the §5 copy-then-typecheck-then-revert cycle).
- Explicitly skipped: React, Tailwind, Vite, Zod (no frontend touch; no schemas authored here).

---

End of plan.
