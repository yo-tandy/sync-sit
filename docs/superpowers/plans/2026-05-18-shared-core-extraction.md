# @ejm/shared-core Extraction Implementation Plan

> **For agentic workers:** Per agent-1 brief, the `executing-plans` skill drives task-by-task execution. Each `pnpm typecheck && pnpm build && pnpm lint` gate is a hard checkpoint — on failure the single offending file is reverted before continuing.

**Goal:** Extract every app-agnostic type, constant, util, and validation schema out of `packages/shared/` into a new `@ejm/shared-core` package, leaving `packages/shared` as a thin babysitter-specific layer that re-exports shared-core. sync-sit (apps/web + apps/functions) builds, typechecks, lints, and tests with **zero import changes**.

**Architecture:** Strangler-fig refactor using §7's copy-then-re-export technique. For each migrated file: (1) copy contents to `packages/shared-core/src/...`, (2) replace the original `packages/shared/src/...` file with a single-line re-export from `@ejm/shared-core/...`, (3) run `pnpm typecheck && pnpm build && pnpm lint`. `packages/shared` adds `@ejm/shared-core` as a workspace dependency. Subpath exports on shared-core use the `./types/*.js` wildcard pattern so stubs can write `export * from '@ejm/shared-core/types/common.js';` and both vite (web) and tsc-CJS (functions) resolve correctly.

**Tech Stack:** TypeScript 6, pnpm workspaces, Vite (web), tsc CJS (functions), zod 3.

**Out of scope (per §8 "Does NOT touch"):**
- `apps/web/`, `apps/functions/`, `apps/study-web/`, `apps/study-functions/`
- `utils/pwa.ts` (browser-only globals — stays in `@ejm/shared`; not in the §5 migration table)
- Test files under `packages/shared/src/**/__tests__/` (they import the public surface, which keeps working through the re-export chain — leaving them in place is the live proof that strangler-fig didn't break anything)
- `firestore.rules`, lint config, security tests (other agents' territory)

**Verification gate (run after every file change):**
```
pnpm typecheck && pnpm build && pnpm lint
```
On failure: `git checkout -- <the-one-file-that-broke>` and stop. SendMessage team-lead with diagnosis. Do NOT proceed.

> **Note on lint scope:** Team-lead's task-assignment said "lint optional (your scope is types/validation, no lint surface)." My standing brief says lint is non-negotiable after every change. I'm keeping lint in the gate because (a) the stub re-exports could trigger unused-import / no-undef rules in lint, (b) standing rules override task-specific relaxations unless the team-lead explicitly approves dropping. If lint fails on a stub for a benign reason (e.g. ESLint can't resolve the new shared-core subpath), I'll SendMessage team-lead before suppressing instead of editing config.

---

## File Structure

**New package created in Task 1:**
```
packages/shared-core/
├── package.json                    # @ejm/shared-core, deps: zod
├── tsconfig.json                   # mirrors packages/shared
├── tsconfig.cjs.json               # mirrors packages/shared (CJS build for functions)
├── vitest.config.ts                # empty config — tests stay in @ejm/shared this phase
└── src/
    ├── index.ts                    # barrel re-exporting types/constants/utils/validation
    ├── types/
    │   └── index.ts                # types barrel (populated as files migrate)
    ├── constants/
    │   └── index.ts                # constants barrel (populated as files migrate)
    ├── utils/
    │   └── index.ts                # utils barrel (populated as files migrate)
    └── validation/
        └── index.ts                # validation barrel (populated as files migrate)
```

**Files migrated (13 baseline + 4 split):**

| Step | shared source                            | shared-core destination                       | Strategy                       |
|------|------------------------------------------|-----------------------------------------------|--------------------------------|
| 2    | `src/types/common.ts`                    | `src/types/common.ts`                         | Full move (stub re-export)     |
| 3    | `src/constants/config.ts`                | `src/constants/config.ts`                     | Full move (stub re-export)     |
| 4    | `src/constants/roles.ts`                 | `src/constants/roles.ts`                      | Full move (stub re-export)     |
| 5    | `src/constants/statuses.ts`              | `src/constants/statuses.ts`                   | Full move (stub re-export)     |
| 6    | `src/utils/schedule.ts`                  | `src/utils/schedule.ts`                       | Full move (stub re-export)     |
| 7    | `src/utils/haversine.ts`                 | `src/utils/haversine.ts`                      | Full move (stub re-export)     |
| 8    | `src/utils/ejm-email.ts`                 | `src/utils/ejm-email.ts`                      | Full move (stub re-export)     |
| 9    | `src/types/schedule.ts`                  | `src/types/schedule.ts`                       | Full move (stub re-export)     |
| 10   | `src/types/notification.ts`              | `src/types/notification.ts`                   | Full move (stub re-export)     |
| 11   | `src/types/admin.ts`                     | `src/types/admin.ts`                          | Full move (stub re-export)     |
| 12   | `src/types/family.ts`                    | `src/types/family.ts`                         | Full move (stub re-export)     |
| 13   | `src/types/verification.ts`              | `src/types/verification.ts`                   | Full move (stub re-export)     |
| 14   | `src/types/reference.ts`                 | `src/types/reference.ts`                      | Full move (stub re-export)     |
| 15   | `src/types/user.ts`                      | `src/types/user.ts` (UserBase, ServiceProviderBase, ParentUser, AdminUser) | **SPLIT** — `BabysitterUser`, `UserDoc`, `BabysitterSummary` stay in shared |
| 16   | `src/types/appointment.ts`               | `src/types/appointment.ts` (RecurringSlot)    | **SPLIT** — `SearchDoc`, `AppointmentDoc` stay in shared |
| 17   | `src/validation/auth.ts`                 | `src/validation/auth.ts`                      | Full move (stub re-export)     |
| 18   | `src/validation/enrollment.ts`           | `src/validation/enrollment.ts` (password, kid, family, search, joinFamily) | **SPLIT** — babysitter schemas stay in shared |

**Stays in `@ejm/shared` permanently:**
- `src/utils/pwa.ts` (browser-only, not in §5 table)
- `src/types/user.ts` — `BabysitterUser`, `UserDoc`, `BabysitterSummary`
- `src/types/appointment.ts` — `SearchDoc`, `AppointmentDoc`
- `src/validation/enrollment.ts` — `babysitterImmutableProfileSchema`, `babysitterProfileSchema`, `babysitterPreferencesSchema`, `isBabysitterProfileComplete`, `BabysitterProfileInput`, `BabysitterPreferencesInput`
- All test files (`__tests__/*.test.ts`) — they continue to validate the public surface through the re-export chain
- `package.json`, `tsconfig.json`, `tsconfig.cjs.json`, `vitest.config.ts` (modified to add `@ejm/shared-core` dependency)
- `src/index.ts` (barrel — no change needed; subordinate barrels in `types/index.ts` etc. re-export the stubs which forward to shared-core)
- `src/types/index.ts`, `src/constants/index.ts`, `src/utils/index.ts`, `src/validation/index.ts` (barrels — no change needed)

---

## Commit Strategy

8 commits, each independently bisectable. Verification gate runs **after each individual file change** (not just per commit) so any broken file is caught and reverted before the next file moves.

| Commit | Scope                                                                                              |
|--------|----------------------------------------------------------------------------------------------------|
| C1     | Task 1: shared-core package shell + `@ejm/shared` depends-on update + Task 2 (`types/common.ts`)   |
| C2     | Tasks 3–5: constants (config, roles, statuses)                                                     |
| C3     | Tasks 6–8: utils (schedule, haversine, ejm-email)                                                  |
| C4     | Tasks 9–14: pure types (schedule, notification, admin, family, verification, reference)            |
| C5     | Task 15: split `types/user.ts` (introduce `ServiceProviderBase`)                                   |
| C6     | Task 16: split `types/appointment.ts` (extract `RecurringSlot`)                                    |
| C7     | Task 17: move `validation/auth.ts` (full migration)                                                |
| C8     | Task 18: split `validation/enrollment.ts`                                                          |

---

## Task 1: Create shared-core package shell

**Files:**
- Create: `packages/shared-core/package.json`
- Create: `packages/shared-core/tsconfig.json`
- Create: `packages/shared-core/tsconfig.cjs.json`
- Create: `packages/shared-core/vitest.config.ts`
- Create: `packages/shared-core/src/index.ts`
- Create: `packages/shared-core/src/types/index.ts`
- Create: `packages/shared-core/src/constants/index.ts`
- Create: `packages/shared-core/src/utils/index.ts`
- Create: `packages/shared-core/src/validation/index.ts`
- Modify: `packages/shared/package.json` (add `@ejm/shared-core` workspace dependency)

- [ ] **Step 1.1: Write `packages/shared-core/package.json`**

```json
{
  "name": "@ejm/shared-core",
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
    "./types/*.js": {
      "import": "./src/types/*.ts",
      "require": "./dist/types/*.js",
      "types": "./src/types/*.ts"
    },
    "./constants/*.js": {
      "import": "./src/constants/*.ts",
      "require": "./dist/constants/*.js",
      "types": "./src/constants/*.ts"
    },
    "./utils/*.js": {
      "import": "./src/utils/*.ts",
      "require": "./dist/utils/*.js",
      "types": "./src/utils/*.ts"
    },
    "./validation/*.js": {
      "import": "./src/validation/*.ts",
      "require": "./dist/validation/*.js",
      "types": "./src/validation/*.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.cjs.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^6.0.2"
  }
}
```

- [ ] **Step 1.2: Write `packages/shared-core/tsconfig.json` (mirror of `packages/shared/tsconfig.json`)**

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

- [ ] **Step 1.3: Write `packages/shared-core/tsconfig.cjs.json` (mirror of `packages/shared/tsconfig.cjs.json`)**

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

- [ ] **Step 1.4: Write `packages/shared-core/vitest.config.ts`** (empty config; tests don't live here this phase)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 1.5: Write four empty barrels and root barrel**

`packages/shared-core/src/types/index.ts`:
```ts
export {};
```

`packages/shared-core/src/constants/index.ts`:
```ts
export {};
```

`packages/shared-core/src/utils/index.ts`:
```ts
export {};
```

`packages/shared-core/src/validation/index.ts`:
```ts
export {};
```

`packages/shared-core/src/index.ts`:
```ts
export * from './types/index.js';
export * from './constants/index.js';
export * from './validation/index.js';
export * from './utils/index.js';
```

- [ ] **Step 1.6: Update `packages/shared/package.json` — add shared-core dependency**

```json
"dependencies": {
  "@ejm/shared-core": "workspace:*",
  "zod": "^3.23.0"
}
```

- [ ] **Step 1.7: Install workspace links**

Run: `pnpm install`
Expected: `Done in <Ns>` with `+ packages/shared-core` registered.

- [ ] **Step 1.8: Verification gate**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: all three commands pass with exit code 0.

If any of the three fail: revert the entire `packages/shared-core/` directory + the `packages/shared/package.json` change, run `pnpm install`, then SendMessage team-lead with the failure log.

---

## Task 2: Migrate `types/common.ts`

**Files:**
- Create: `packages/shared-core/src/types/common.ts`
- Modify: `packages/shared-core/src/types/index.ts`
- Modify: `packages/shared/src/types/common.ts` (replace with re-export stub)

- [ ] **Step 2.1: Copy `packages/shared/src/types/common.ts` verbatim to `packages/shared-core/src/types/common.ts`**

The exact content to write:

```ts
/** Firestore Timestamp-compatible type (works with both client and admin SDK) */
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate: () => Date;
}

/** Latitude/Longitude pair */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Notification channel preferences */
export interface NotifChannels {
  push: boolean;
  email: boolean;
}

/** All notification preference categories */
export interface NotifPrefs {
  newRequest: NotifChannels;
  confirmed: NotifChannels;
  cancelled: NotifChannels;
  reminders: NotifChannels;
  references?: NotifChannels;
}

/** Default notification preferences (all on) */
export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  newRequest: { push: true, email: true },
  confirmed: { push: true, email: true },
  cancelled: { push: true, email: true },
  reminders: { push: true, email: false },
  references: { push: true, email: true },
};
```

- [ ] **Step 2.2: Add to `packages/shared-core/src/types/index.ts`**

Replace `export {};` with:
```ts
export * from './common.js';
```

- [ ] **Step 2.3: Replace `packages/shared/src/types/common.ts` with re-export stub**

```ts
export * from '@ejm/shared-core/types/common.js';
```

- [ ] **Step 2.4: Verification gate**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: all pass.

On fail: `git checkout -- packages/shared/src/types/common.ts packages/shared-core/src/types/common.ts packages/shared-core/src/types/index.ts`, then SendMessage team-lead.

- [ ] **Step 2.5: Commit C1 (package shell + first migration)**

```bash
git add packages/shared-core packages/shared/package.json packages/shared/src/types/common.ts pnpm-lock.yaml
git commit -m "feat(shared-core): scaffold package and migrate types/common.ts

Creates @ejm/shared-core with subpath exports (./types/*.js, ./constants/*.js,
./utils/*.js, ./validation/*.js) and migrates types/common.ts as the first
file. packages/shared depends on @ejm/shared-core via workspace:* and re-exports
the migrated file via stub. No consumer import changes in apps/web or
apps/functions.

Refs: sync-study plan §8 Agent 1, §5 step 1."
```

---

## Tasks 3–5: Migrate constants (config, roles, statuses)

Repeat the exact same 4-step pattern (copy → barrel-add → stub → verify) for each file. After all three pass, commit C2.

### Task 3: `constants/config.ts`

**Files:**
- Create: `packages/shared-core/src/constants/config.ts`
- Modify: `packages/shared-core/src/constants/index.ts`
- Modify: `packages/shared/src/constants/config.ts`

- [ ] **Step 3.1: Copy entire content of `packages/shared/src/constants/config.ts` verbatim to `packages/shared-core/src/constants/config.ts`** (use `Read` on the source then `Write` to the destination — preserve every line).

- [ ] **Step 3.2: Append to `packages/shared-core/src/constants/index.ts`**

Replace `export {};` with:
```ts
export * from './config.js';
```

- [ ] **Step 3.3: Replace `packages/shared/src/constants/config.ts` with stub**

```ts
export * from '@ejm/shared-core/constants/config.js';
```

- [ ] **Step 3.4: Verification gate** — `pnpm typecheck && pnpm build && pnpm lint`. On fail, revert the three files and SendMessage team-lead.

### Task 4: `constants/roles.ts`

**Files:** create `packages/shared-core/src/constants/roles.ts`; modify `packages/shared-core/src/constants/index.ts`; modify `packages/shared/src/constants/roles.ts`.

- [ ] **Step 4.1: Copy verbatim** to `packages/shared-core/src/constants/roles.ts`:

```ts
export const UserRole = {
  BABYSITTER: 'babysitter',
  PARENT: 'parent',
  ADMIN: 'admin',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
```

- [ ] **Step 4.2: Add to `packages/shared-core/src/constants/index.ts`:**
```ts
export * from './roles.js';
```

- [ ] **Step 4.3: Replace `packages/shared/src/constants/roles.ts` with stub:**
```ts
export * from '@ejm/shared-core/constants/roles.js';
```

- [ ] **Step 4.4: Verification gate.**

### Task 5: `constants/statuses.ts`

**Files:** create `packages/shared-core/src/constants/statuses.ts`; modify `packages/shared-core/src/constants/index.ts`; modify `packages/shared/src/constants/statuses.ts`.

- [ ] **Step 5.1: Copy entire content of `packages/shared/src/constants/statuses.ts` verbatim** (use Read → Write; preserve all `AccountStatus`, `AppointmentStatus`, `AppointmentStatusReason`, `SearchType`, `SearchStatus`, and any others present).

- [ ] **Step 5.2: Add to `packages/shared-core/src/constants/index.ts`:**
```ts
export * from './statuses.js';
```

- [ ] **Step 5.3: Replace `packages/shared/src/constants/statuses.ts` with stub:**
```ts
export * from '@ejm/shared-core/constants/statuses.js';
```

- [ ] **Step 5.4: Verification gate.**

- [ ] **Step 5.5: Commit C2**

```bash
git add packages/shared-core/src/constants packages/shared/src/constants
git commit -m "feat(shared-core): migrate constants (config, roles, statuses)

Copies the three constant modules to @ejm/shared-core and replaces the
originals with stub re-exports. Verification gate (typecheck + build + lint)
passed after each individual file move.

Refs: sync-study plan §5 steps 2–4."
```

---

## Tasks 6–8: Migrate utils (schedule, haversine, ejm-email)

Same pattern: copy → barrel-add → stub → verify per file. Commit C3 at the end.

### Task 6: `utils/schedule.ts`

**Files:** create `packages/shared-core/src/utils/schedule.ts`; modify `packages/shared-core/src/utils/index.ts`; modify `packages/shared/src/utils/schedule.ts`.

- [ ] **Step 6.1: Copy `packages/shared/src/utils/schedule.ts` verbatim to `packages/shared-core/src/utils/schedule.ts`** (Read → Write; preserve all functions and imports — note: this file imports from `../constants/*.js` which still resolves because constants/* are already in shared-core after Tasks 3–5; the import path inside the COPIED file must be updated from `../constants/index.js` to `../constants/index.js` (no change — relative paths within shared-core remain valid since constants live there too). If the source file imports from `../types/...`, those types also live in shared-core after Task 2, so the relative path stays valid.

- [ ] **Step 6.2: Add to `packages/shared-core/src/utils/index.ts`:**
```ts
export * from './schedule.js';
```

- [ ] **Step 6.3: Replace `packages/shared/src/utils/schedule.ts` with stub:**
```ts
export * from '@ejm/shared-core/utils/schedule.js';
```

- [ ] **Step 6.4: Verification gate.**

### Task 7: `utils/haversine.ts`

- [ ] **Step 7.1: Copy verbatim** (pure function, no internal deps) from `packages/shared/src/utils/haversine.ts` to `packages/shared-core/src/utils/haversine.ts`.

- [ ] **Step 7.2: Add to `packages/shared-core/src/utils/index.ts`:**
```ts
export * from './haversine.js';
```

- [ ] **Step 7.3: Replace `packages/shared/src/utils/haversine.ts` with stub:**
```ts
export * from '@ejm/shared-core/utils/haversine.js';
```

- [ ] **Step 7.4: Verification gate.**

### Task 8: `utils/ejm-email.ts`

- [ ] **Step 8.1: Copy verbatim** from `packages/shared/src/utils/ejm-email.ts` to `packages/shared-core/src/utils/ejm-email.ts`. If the source imports `EJM_DOMAIN` from `../constants/config.js`, the relative import remains valid in shared-core (constants/config.ts lives there).

- [ ] **Step 8.2: Add to `packages/shared-core/src/utils/index.ts`:**
```ts
export * from './ejm-email.js';
```

- [ ] **Step 8.3: Replace `packages/shared/src/utils/ejm-email.ts` with stub:**
```ts
export * from '@ejm/shared-core/utils/ejm-email.js';
```

- [ ] **Step 8.4: Verification gate.**

- [ ] **Step 8.5: Commit C3**

```bash
git add packages/shared-core/src/utils packages/shared/src/utils
git commit -m "feat(shared-core): migrate utils (schedule, haversine, ejm-email)

Refs: sync-study plan §5 steps 5–7."
```

---

## Tasks 9–14: Migrate pure types (schedule, notification, admin, family, verification, reference)

For each of the six files, follow the four-step copy → barrel-add → stub → verify pattern. Each file's contents are copied verbatim; internal `../constants/*.js` and `./common.js` imports remain valid because those targets already live in shared-core after Tasks 2–5.

### Task 9: `types/schedule.ts`

- [ ] **Step 9.1: Copy** `packages/shared/src/types/schedule.ts` → `packages/shared-core/src/types/schedule.ts` verbatim.
- [ ] **Step 9.2: Add to `packages/shared-core/src/types/index.ts`:** `export * from './schedule.js';`
- [ ] **Step 9.3: Replace `packages/shared/src/types/schedule.ts`:** `export * from '@ejm/shared-core/types/schedule.js';`
- [ ] **Step 9.4: Verification gate.**

### Task 10: `types/notification.ts`

- [ ] **Step 10.1: Copy** verbatim to shared-core.
- [ ] **Step 10.2: Add** `export * from './notification.js';` to `packages/shared-core/src/types/index.ts`.
- [ ] **Step 10.3: Replace** stub: `export * from '@ejm/shared-core/types/notification.js';`
- [ ] **Step 10.4: Verification gate.**

### Task 11: `types/admin.ts`

- [ ] **Step 11.1: Copy** verbatim to shared-core.
- [ ] **Step 11.2: Add** `export * from './admin.js';`
- [ ] **Step 11.3: Replace** stub: `export * from '@ejm/shared-core/types/admin.js';`
- [ ] **Step 11.4: Verification gate.**

### Task 12: `types/family.ts`

- [ ] **Step 12.1: Copy** verbatim to shared-core.
- [ ] **Step 12.2: Add** `export * from './family.js';`
- [ ] **Step 12.3: Replace** stub: `export * from '@ejm/shared-core/types/family.js';`
- [ ] **Step 12.4: Verification gate.**

### Task 13: `types/verification.ts`

- [ ] **Step 13.1: Copy** verbatim to shared-core.
- [ ] **Step 13.2: Add** `export * from './verification.js';`
- [ ] **Step 13.3: Replace** stub: `export * from '@ejm/shared-core/types/verification.js';`
- [ ] **Step 13.4: Verification gate.**

### Task 14: `types/reference.ts`

- [ ] **Step 14.1: Copy** verbatim to shared-core.
- [ ] **Step 14.2: Add** `export * from './reference.js';`
- [ ] **Step 14.3: Replace** stub: `export * from '@ejm/shared-core/types/reference.js';`
- [ ] **Step 14.4: Verification gate.**

- [ ] **Step 14.5: Commit C4**

```bash
git add packages/shared-core/src/types packages/shared/src/types
git commit -m "feat(shared-core): migrate pure types (schedule, notification, admin, family, verification, reference)

Refs: sync-study plan §5 steps 8–13."
```

---

## Task 15: SPLIT `types/user.ts` — introduce `ServiceProviderBase`

**Files:**
- Create: `packages/shared-core/src/types/user.ts`
- Modify: `packages/shared-core/src/types/index.ts`
- Modify: `packages/shared/src/types/user.ts` (rewrite to babysitter-only fragment)

This is the most delicate task. We split the current `BabysitterUser` into two layers: a generic `ServiceProviderBase` (shared-core) and the babysitter-specific extension (shared).

- [ ] **Step 15.1: Write `packages/shared-core/src/types/user.ts`**

```ts
import type { FirestoreTimestamp, LatLng, NotifPrefs } from './common.js';
import type { UserRole, AccountStatus, AreaMode, Language } from '../constants/index.js';

/** Base user fields shared by all roles */
export interface UserBase {
  uid: string;
  role: UserRole;
  email: string;
  status: AccountStatus;
  firstName: string;
  lastName: string;
  language: Language;
  notifPrefs: NotifPrefs;
  fcmTokens: string[];
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  lastLoginAt?: FirestoreTimestamp;
  consentAt?: FirestoreTimestamp;
  consentVersion?: string;

  /** True once the user has dismissed the "Add to Home Screen" banner. */
  dismissedPwaInstallBanner?: boolean;
}

/**
 * Fields common to any service provider (babysitter, tutor, …).
 * Apps extend this with role-specific fields (e.g. BabysitterUser, TutorUser).
 */
export interface ServiceProviderBase extends UserBase {
  ejemEmail: string;
  dateOfBirth: FirestoreTimestamp;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  classLevel: string;
  photoUrl?: string;
  languages: string[];
  aboutMe?: string;

  // Contact (at least one required)
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;

  // Area
  areaMode: AreaMode;
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: LatLng;
  areaRadiusKm?: number;

  // Enrollment state
  enrollmentComplete?: boolean;

  // Search visibility (default false — must be activated by the provider)
  searchable?: boolean;

  // Revalidation
  lastRevalidatedAt?: FirestoreTimestamp;
  revalidationYear?: number;
}

/** Parent-specific user fields */
export interface ParentUser extends UserBase {
  role: 'parent';
  familyId: string;
}

/** Admin user fields */
export interface AdminUser extends UserBase {
  role: 'admin';
}
```

- [ ] **Step 15.2: Add to `packages/shared-core/src/types/index.ts`:**
```ts
export * from './user.js';
```

- [ ] **Step 15.3: Rewrite `packages/shared/src/types/user.ts`** (babysitter-only fragment + UserDoc union + BabysitterSummary)

```ts
import type { FirestoreTimestamp } from '@ejm/shared-core/types/common.js';
import type { ServiceProviderBase, ParentUser, AdminUser } from '@ejm/shared-core/types/user.js';

// Re-export the generic types so consumers importing from '@ejm/shared' still
// see the full surface (UserBase, ServiceProviderBase, ParentUser, AdminUser).
export * from '@ejm/shared-core/types/user.js';

/** Babysitter-specific user fields */
export interface BabysitterUser extends ServiceProviderBase {
  role: 'babysitter';

  // Babysitting preferences
  kidAgeRange: { min: number; max: number };
  maxKids: number;
  hourlyRate: number;

  // Contact sharing consent (babysitter-specific)
  contactSharingConsent?: boolean;
  approvedFamilies?: string[];
}

/** Union type for any user document in sync-sit */
export type UserDoc = BabysitterUser | ParentUser | AdminUser;

/**
 * Lightweight babysitter info used in family-facing UI (search results,
 * favorites, dashboard cards). A subset of BabysitterUser with a few
 * computed fields (age, distance, name).
 */
export interface BabysitterSummary {
  uid: string;
  firstName: string;
  lastName: string;
  name?: string;           // pre-formatted display name
  age?: number;            // computed from dateOfBirth
  classLevel?: string;
  languages?: string[];
  photoUrl?: string | null;
  aboutMe?: string | null;
  kidAgeRange?: { min: number; max: number };
  maxKids?: number;
  hourlyRate?: number;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  distance?: number;       // computed from search
  referenceCount?: number; // computed from search
  worksInYourArea?: boolean;
  isPreferred?: boolean;
}

// Tag the unused import explicitly so TS doesn't warn on lints that flag it.
type _KeepFirestoreTimestamp = FirestoreTimestamp;
```

Note on `_KeepFirestoreTimestamp`: only retain this if the lint config flags an unused import. If `FirestoreTimestamp` is genuinely unused after the rewrite, just delete the import line. (Check by running the verification gate — if lint complains about an unused import, delete the import; if lint complains about an unused alias, delete the `_Keep…` line.)

- [ ] **Step 15.4: Verification gate.**

If lint complains about `'FirestoreTimestamp' is defined but never used`: remove `, FirestoreTimestamp` from the import on line 1 AND the `_KeepFirestoreTimestamp` line. Rerun gate.

If `apps/web` typecheck reports a missing field on `BabysitterUser` (e.g. it expected `ejemEmail`, `dateOfBirth`, `gender`, `classLevel`, `photoUrl`, `languages`, `aboutMe`, `contactEmail`, `contactPhone`, `whatsapp`, `areaMode`, `arrondissements`, `areaAddress`, `areaLatLng`, `areaRadiusKm`, `enrollmentComplete`, `searchable`, `lastRevalidatedAt`, `revalidationYear` directly on BabysitterUser): this should NOT happen because `BabysitterUser extends ServiceProviderBase extends UserBase` covers every field that was on the pre-split `BabysitterUser`. If it does happen, revert the three files and SendMessage team-lead — do not improvise the type shape.

- [ ] **Step 15.5: Commit C5**

```bash
git add packages/shared-core/src/types/user.ts packages/shared-core/src/types/index.ts packages/shared/src/types/user.ts
git commit -m "refactor(shared-core): split types/user.ts via ServiceProviderBase

Introduces ServiceProviderBase as the cross-app generic for any provider role
(babysitter, tutor, …). Moves UserBase, ServiceProviderBase, ParentUser, and
AdminUser to @ejm/shared-core. BabysitterUser now extends ServiceProviderBase
and lives in @ejm/shared along with UserDoc and BabysitterSummary, both
babysitter-specific. No public-surface changes: @ejm/shared re-exports every
shared-core type via 'export * from @ejm/shared-core/types/user.js'.

Refs: sync-study plan §5 The ServiceProviderBase Split, §8 Agent 1 task 3."
```

---

## Task 16: SPLIT `types/appointment.ts` — extract `RecurringSlot`

**Files:**
- Create: `packages/shared-core/src/types/appointment.ts`
- Modify: `packages/shared-core/src/types/index.ts`
- Modify: `packages/shared/src/types/appointment.ts`

- [ ] **Step 16.1: Write `packages/shared-core/src/types/appointment.ts`**

```ts
import type { DayOfWeek } from '../constants/config.js';

/**
 * A single recurring weekly slot. Used by sync-sit's babysitting recurring
 * searches/appointments and by sync-study's recurring tutoring sessions.
 */
export interface RecurringSlot {
  day: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string;
}
```

- [ ] **Step 16.2: Add to `packages/shared-core/src/types/index.ts`:**
```ts
export * from './appointment.js';
```

- [ ] **Step 16.3: Rewrite `packages/shared/src/types/appointment.ts`** (keep `SearchDoc` and `AppointmentDoc`; import `RecurringSlot` from shared-core)

```ts
import type { FirestoreTimestamp, LatLng } from './common.js';
import type {
  AppointmentStatus,
  AppointmentStatusReason,
  SearchType,
  SearchStatus,
} from '../constants/index.js';
import type { RecurringSlot } from '@ejm/shared-core/types/appointment.js';

// Re-export RecurringSlot so consumers importing from '@ejm/shared' still see it.
export type { RecurringSlot };

export interface SearchDoc {
  searchId: string;
  familyId: string;
  createdByUserId: string;
  type: SearchType;
  status: SearchStatus;

  // One-time
  date?: string; // "YYYY-MM-DD"
  startTime?: string;
  endTime?: string;

  // Recurring
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;

  // Common
  kidIds: string[];
  address: string;
  latLng: LatLng;
  offeredRate?: number;
  additionalInfo?: string;
  filters: {
    minAge?: number;
    gender?: string;
    requireReferences?: boolean;
  };

  createdAt: FirestoreTimestamp;
}

export interface AppointmentDoc {
  appointmentId: string;
  searchId: string;
  familyId: string;
  babysitterUserId: string;
  createdByUserId: string;
  type: SearchType;
  status: AppointmentStatus;
  statusReason?: AppointmentStatusReason;
  cancellationReason?: string;
  cancelledFromStatus?: string;

  // Copied from search at creation
  date?: string;
  startTime?: string;
  endTime?: string;
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;
  kidIds: string[];
  address: string;
  latLng: LatLng;
  offeredRate?: number;
  message?: string;
  additionalInfo?: string;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  confirmedAt?: FirestoreTimestamp;
  cancelledAt?: FirestoreTimestamp;
  softDeletedAt?: FirestoreTimestamp;

  // Modification tracking
  modified?: boolean;
  modifiedAt?: FirestoreTimestamp;
  modifiedFields?: string[];

  // Resubmission tracking
  isResubmission?: boolean;
  resubmittedFromAppointmentId?: string;
}
```

- [ ] **Step 16.4: Verification gate.**

- [ ] **Step 16.5: Commit C6**

```bash
git add packages/shared-core/src/types/appointment.ts packages/shared-core/src/types/index.ts packages/shared/src/types/appointment.ts
git commit -m "refactor(shared-core): extract RecurringSlot to shared-core

RecurringSlot is used by both sync-sit (babysitting recurring searches) and
sync-study (recurring tutoring sessions). SearchDoc and AppointmentDoc remain
babysitter-specific in @ejm/shared. The shared file re-exports RecurringSlot
so existing imports from @ejm/shared still resolve.

Refs: sync-study plan §5 step 15, §8 Agent 1 task 4."
```

---

## Task 17: Move `validation/auth.ts` (full migration)

**Files:**
- Create: `packages/shared-core/src/validation/auth.ts`
- Modify: `packages/shared-core/src/validation/index.ts`
- Modify: `packages/shared/src/validation/auth.ts`

- [ ] **Step 17.1: Copy `packages/shared/src/validation/auth.ts` verbatim to `packages/shared-core/src/validation/auth.ts`**

Verify the import path `../constants/config.js` still resolves (it does — `constants/config.ts` is in shared-core after Task 3). No edits needed.

- [ ] **Step 17.2: Add to `packages/shared-core/src/validation/index.ts`** (replace `export {};`):
```ts
export * from './auth.js';
```

- [ ] **Step 17.3: Replace `packages/shared/src/validation/auth.ts` with stub:**
```ts
export * from '@ejm/shared-core/validation/auth.js';
```

- [ ] **Step 17.4: Verification gate.**

- [ ] **Step 17.5: Commit C7**

```bash
git add packages/shared-core/src/validation/auth.ts packages/shared-core/src/validation/index.ts packages/shared/src/validation/auth.ts
git commit -m "feat(shared-core): migrate validation/auth.ts

emailSchema, ejemEmailSchema, passwordSchema, verificationCodeSchema,
loginSchema, and LoginInput are entirely generic — full move with a stub
re-export from @ejm/shared.

Refs: sync-study plan §5 step 16, §8 Agent 1 task 6."
```

---

## Task 18: SPLIT `validation/enrollment.ts`

**Files:**
- Create: `packages/shared-core/src/validation/enrollment.ts`
- Modify: `packages/shared-core/src/validation/index.ts`
- Modify: `packages/shared/src/validation/enrollment.ts`

- [ ] **Step 18.1: Write `packages/shared-core/src/validation/enrollment.ts`** (password requirements + parent/family/kid/search/joinFamily schemas)

```ts
import { z } from 'zod';

// ── Password Validation ──

export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

/** Check password requirements individually (for UI feedback) */
export function checkPasswordRequirements(password: string) {
  return {
    minLength: password.length >= 8,
    hasLowercase: /[a-z]/.test(password),
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };
}

// ── Parent/Family Enrollment ──

export const kidSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  age: z.number().min(0).max(18),
  languages: z.array(z.string()).min(1, 'Select at least one language'),
});

export const familyEnrollmentSchema = z.object({
  familyName: z.string().min(1, 'Family name is required'),
  lastName: z.string().optional(), // if different from family name
  firstName: z.string().min(1, 'First name is required'),
  address: z.string().min(1, 'Address is required'),
  pets: z.string().optional(),
  note: z.string().optional(),
  kids: z.array(kidSchema).optional(),
});

export const searchDefaultsSchema = z.object({
  minBabysitterAge: z.number().optional(),
  preferredGender: z.string().optional(),
  requireReferences: z.boolean().optional(),
  maxRate: z.number().optional(),
});

export const joinFamilySchema = z.object({
  lastName: z.string().optional(),
  firstName: z.string().min(1, 'First name is required'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type KidInput = z.infer<typeof kidSchema>;
export type FamilyEnrollmentInput = z.infer<typeof familyEnrollmentSchema>;
export type SearchDefaultsInput = z.infer<typeof searchDefaultsSchema>;
export type JoinFamilyInput = z.infer<typeof joinFamilySchema>;
```

> Note: `searchDefaultsSchema` keeps `minBabysitterAge` and `maxRate` field names as-is rather than generalizing to `minProviderAge` / `maxRate`. Generalization is out of scope for Agent 1 — Agent 4 handles sync-study-specific schemas. The current names work for both apps; only the field semantics differ in practice.

- [ ] **Step 18.2: Add to `packages/shared-core/src/validation/index.ts`:**
```ts
export * from './enrollment.js';
```

- [ ] **Step 18.3: Rewrite `packages/shared/src/validation/enrollment.ts`** (babysitter-only fragment + re-export shared-core)

```ts
import { z } from 'zod';

// Re-export the cross-app schemas so consumers importing from '@ejm/shared'
// still see the full surface.
export * from '@ejm/shared-core/validation/enrollment.js';

// ── Babysitter Enrollment (babysitter-specific) ──

/** Immutable profile fields (step 2 of enrollment) */
export const babysitterImmutableProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  classLevel: z.string().min(1, 'Class is required'),
});

/** Full profile schema (backward compatible) */
export const babysitterProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  classLevel: z.string().min(1, 'Class is required'),
  languages: z.array(z.string()).min(1, 'Select at least one language'),
});

/** Check if a babysitter has all mandatory fields for activation */
export function isBabysitterProfileComplete(user: Record<string, unknown>): boolean {
  const languages = user.languages as string[] | undefined;
  const kidAgeRange = user.kidAgeRange as { min: number; max: number } | undefined;
  const maxKids = user.maxKids as number | undefined;
  const hourlyRate = user.hourlyRate as number | undefined;
  const areaMode = user.areaMode as string | undefined;
  const arrondissements = user.arrondissements as string[] | undefined;
  const areaAddress = user.areaAddress as string | undefined;

  const hasLanguages = languages && languages.length > 0;
  const hasAgeRange = kidAgeRange && typeof kidAgeRange.min === 'number' && typeof kidAgeRange.max === 'number';
  const hasMaxKids = typeof maxKids === 'number' && maxKids > 0;
  const hasRate = typeof hourlyRate === 'number' && hourlyRate > 0;
  const hasArea = areaMode === 'distance'
    ? !!areaAddress
    : (arrondissements && arrondissements.length > 0);

  return !!(hasLanguages && hasAgeRange && hasMaxKids && hasRate && hasArea);
}

export const babysitterPreferencesSchema = z
  .object({
    kidAgeMin: z.number().min(0).max(18),
    kidAgeMax: z.number().min(0).max(18),
    maxKids: z.number().min(1).max(10),
    hourlyRate: z.number().min(0),
    aboutMe: z.string().optional(),
    contactEmail: z.string().email().optional().or(z.literal('')),
    contactPhone: z.string().optional(),
    areaMode: z.enum(['arrondissement', 'distance']),
    arrondissements: z.array(z.string()).optional(),
    areaAddress: z.string().optional(),
    areaRadiusKm: z.number().optional(),
  })
  .refine(
    (data) =>
      (data.contactEmail && data.contactEmail !== '') ||
      (data.contactPhone && data.contactPhone !== ''),
    { message: 'Provide at least one contact method (email or phone)' }
  )
  .refine((data) => data.kidAgeMin <= data.kidAgeMax, {
    message: 'Minimum age must be less than or equal to maximum age',
  });

export type BabysitterProfileInput = z.infer<typeof babysitterProfileSchema>;
export type BabysitterPreferencesInput = z.infer<typeof babysitterPreferencesSchema>;
```

- [ ] **Step 18.4: Verification gate.**

Tests for validation live in `packages/shared/src/validation/__tests__/schemas.test.ts` and exercise both halves through the `@ejm/shared` re-export chain. They should still pass without modification. Run `pnpm --filter @ejm/shared test` to confirm.

If a test fails: revert all three Task 18 files and SendMessage team-lead. Do not edit tests.

- [ ] **Step 18.5: Commit C8**

```bash
git add packages/shared-core/src/validation/enrollment.ts packages/shared-core/src/validation/index.ts packages/shared/src/validation/enrollment.ts
git commit -m "refactor(shared-core): split validation/enrollment.ts

Moves strongPasswordSchema, checkPasswordRequirements, kidSchema,
familyEnrollmentSchema, searchDefaultsSchema, joinFamilySchema (plus their
inferred input types) to @ejm/shared-core. Babysitter-specific schemas
(babysitterImmutableProfileSchema, babysitterProfileSchema,
babysitterPreferencesSchema, isBabysitterProfileComplete) stay in @ejm/shared.
The shared file re-exports shared-core's surface so consumers importing from
'@ejm/shared' continue to see every schema.

Refs: sync-study plan §5 step 17, §8 Agent 1 task 5."
```

---

## Post-extraction handoff checklist

Once Tasks 1–18 are complete:

- [ ] **Final verification:** Re-run the full gate one more time: `pnpm typecheck && pnpm build && pnpm lint`. Plus `pnpm test:unit` (shared package vitest) and `pnpm --filter web test` to confirm test suites still green.
- [ ] **Spot-check:** `git diff origin/feature/sync-study-shared-core...HEAD --stat` — sanity-check that `apps/web/` and `apps/functions/` have **zero** changes (zero-import-change rule).
- [ ] **Verify package boundaries:** `grep -r "from '@ejm/shared/" apps packages` → expect zero hits (no deep subpath imports of @ejm/shared from apps).
- [ ] **SendMessage team-lead** the completion report (branch, 8 commit SHAs, files touched, verification log, the §8 Done-when satisfied, any deferred items — e.g. `searchDefaultsSchema` field-name generalization left to Agent 4).

---

## Local view-types in apps/web — lift decisions

The lint-cleanup PR introduced several locally-defined view-types in `apps/web` that the team-lead flagged as candidates to lift into `@ejm/shared-core`. I audited each one and classified into three buckets. **None are lifted in this PR** — promoting any of them requires editing files outside my §8 "Owns" list (apps/web stores, components, pages). I report them here so the coordinator can dispatch follow-up work to the appropriate agent (likely Agent 2 for UI-adjacent stores, or a dedicated cleanup commit).

### Bucket A — Lift recommended in a follow-up commit (3 types)

| Type | Current location | Why lift | Target home |
|------|------------------|----------|-------------|
| `AdminAuditLogEntry` | `apps/web/src/stores/adminStore.ts:68` | Wire-shape returned by the `listAuditLogs` callable — used by both apps' admin dashboards. Distinct from the shared Firestore-storage `AuditLogDoc` because it carries `id`, enriched `adminInfo`/`targetInfo`, and a serialized timestamp. | `@ejm/shared-core/types/admin.ts` (alongside `AuditLogDoc`) |
| `WireTimestamp` | `apps/web/src/stores/adminStore.ts:57` | Generic envelope for Firestore Timestamps serialized through `httpsCallable` responses. Both apps need this every time a callable returns a timestamped doc. | `@ejm/shared-core/types/common.ts` (sits next to `FirestoreTimestamp`) |
| Local `VerificationDoc` (shadowed) | `apps/web/src/stores/verificationStore.ts:5` | This is a wire-shape with `id` (not `verificationId`), string dates (not Timestamps), and admin-enrichment fields (`familyName`, `parentName`, `familyParentNames`, `familyKids`). It silently shadows the canonical `VerificationDoc` from `@ejm/shared` — a code smell. Both apps will need this exact admin-list wire shape. | `@ejm/shared-core/types/verification.ts` as a NEW type (e.g. `AdminVerificationListItem` or `VerificationWireDoc`) — the canonical Firestore `VerificationDoc` stays unchanged. Then `verificationStore.ts` imports the new type and stops shadowing. |

**Why not lift in this PR:** Promoting `AdminAuditLogEntry` requires editing `apps/web/src/stores/adminStore.ts` to import from `@ejm/shared` instead of declaring locally; same for `verificationStore.ts`. Both files are outside `packages/shared-core/` and `packages/shared/`, so they're outside my §8 "Owns" list. Lifting the type definitions alone (without removing the local declarations) would create duplicate symbols and confuse consumers.

**Recommended sequence:** After Phase 1 completion, a follow-up agent (likely the coordinator routes this to Agent 2 since the affected files are stores/components, or a dedicated mini-task) does: (a) add the three types to shared-core, (b) update the stores to import from `@ejm/shared`, (c) delete the local declarations. Single small commit, easy to review.

### Bucket B — Schema gap, not a type lift (1 cluster)

`ParentUserView` (in `apps/web/src/pages/family/AccountPage.tsx`) and `ParentUserWithContact` (in `apps/web/src/components/endorsements/EndorsementDialog.tsx`) both extend `ParentUser` with `phone?: string`, `whatsapp?: string`, and (in the AccountPage variant) `photoUrl?: string`. Both files have an explanatory comment that says "these fields exist on production user docs but are not yet declared on the shared `ParentUser` type."

This is a **schema correction**, not a type lift. The canonical `ParentUser` in `@ejm/shared-core/types/user.ts` (introduced by Task 15) should grow these fields, then both local types become unnecessary.

**Why not in this PR:** Adding fields to `ParentUser` is a substantive schema change — it implies the Firestore rules, the enrollFamily/joinFamily callables, and possibly the validation schemas accept these fields. That cross-cuts agent 3 (functions), agent 6 (rules), and agent 1 (validation). Best handled as a single coordinated cross-agent change after Phase 1 lands. I'm flagging it; coordinator decides timing.

**Recommended action item:** Open a follow-up task to "add `phone`, `whatsapp`, `photoUrl` to `ParentUser` and the parent-side validation/rules surface". Not Agent 1's work alone.

### Bucket C — Stays in apps/web (3 types, no lift)

| Type | Location | Why it stays |
|------|----------|--------------|
| `AppointmentWithFamily` | `AppointmentCard.tsx:17` | Composed from babysitter-specific `AppointmentDoc` (kept in `@ejm/shared`). sync-study will have its own session-with-family shape. Genuinely sync-sit-only. |
| `EnrichedAppointment` | `RequestDetailPage.tsx:23` | Same reason — extends babysitter-specific `AppointmentDoc` with babysitter-page-specific fields (`kids`, `pets`, `familyNote`). |
| `AdminAppointmentListItem` | `adminStore.ts:28` | The shape is app-agnostic, but the **name** is babysitter-flavored. Sync-study will need a parallel `AdminSessionListItem` or both should be unified as `AdminBookingListItem`. The naming + structural decision is bigger than a mechanical lift; Agent 4 (sync-study domain) should design the unification when sync-study admin views come online. Defer. |
| `AppointmentDoc & { resubmitted?: ... }` (flagged in brief) | (not present) | The brief mentions this as a candidate; investigation showed `isResubmission` and `resubmittedFromAppointmentId` are already canonical fields on `AppointmentDoc`. The only `resubmitted: true` reference is a stray field in `useAppointments.behavior.test.ts:182` — a test-fixture artifact, not a type extension. Nothing to lift. |

### Summary for coordinator

After my 8 commits land, the coordinator should route a follow-up "lift-view-types" task somewhere that owns apps/web stores. That task lifts the three Bucket A types into shared-core and removes the local shadows. Bucket B is a separate cross-cutting schema-correction conversation. Bucket C stays put.

---

## Self-review notes

1. **Spec coverage:** All 6 §8 Agent 1 tasks covered — Task 1 (package shell), Tasks 2–14 (13 baseline files), Task 15 (split user.ts), Task 16 (split appointment.ts), Task 17 (move auth.ts), Task 18 (split enrollment.ts). The §5 step table maps 1:1 to Tasks 2–18. Plus a new "Local view-types in apps/web — lift decisions" section addressing the team-lead's view-types callout (deferred to a follow-up commit, not Agent 1's scope to touch consumer files).
2. **Placeholder scan:** No "TBD" / "implement later" / "similar to" placeholders. Every code block is full and complete. Every commit message is written out.
3. **Type consistency:** `ServiceProviderBase` is named consistently (not "ProviderBase" or "ServiceProvider"). `RecurringSlot` is named consistently. The §5 spec's `role: string` on ServiceProviderBase was intentionally dropped here — `UserBase` already declares `role: UserRole`, so re-declaring it as `role: string` on ServiceProviderBase would widen the type. Letting subtypes (`BabysitterUser`, `TutorUser`) narrow it via `role: 'babysitter' | 'tutor'` is the correct shape.
4. **Risk hotspots flagged:** Task 15 (the user split) and Task 18 (the enrollment split) explicitly call out the revert procedure if anything fails. Task 16's RecurringSlot extraction is low-risk because the type is structurally trivial.
