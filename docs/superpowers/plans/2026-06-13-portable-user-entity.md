# Portable User Entity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `users/{uid}.role` + role-specific subtype unions with a single generic `User` entity that has a `profiles: { babysitter?, tutor?, parent? }` map. One person can have both a babysitter profile (sync-sit side) and a tutor profile (sync-study side) — or any combination. Cross-app login becomes a matter of which profiles exist on a user. Includes the prod migration that lifts existing sync-sit users' top-level `role` into `profiles.{role}`.

**Architecture:**
- `packages/shared-core` defines the generic `User`, `ProfileBase`, and `ParentProfile` types (cross-app — both apps consume).
- `packages/sit-core` (renamed from `packages/shared`) defines `BabysitterProfile` and related sync-sit-only types (`AppointmentDoc`, `RecurringSlot`, etc., unchanged).
- `packages/study-core` (new) defines `TutorProfile`, `SubjectOffering`, `LocationPref` (moved from `apps/study-functions/src/types/`).
- Each app declares a narrowed `SitUser` / `StudyUser` that extends `User` with its specific profile shape.
- Migration: a one-time callable that lifts each existing user's top-level `role` (+ role-specific fields) into the right `profiles.{babysitter|parent}` slot.
- Transitional fallback: readers prefer `user.profiles.{role}` but fall back to `user.role` for the brief window between deploy and migration completion. Removed in a follow-up PR after migration is verified in prod.

**Tech Stack:** TypeScript, Firebase Firestore + Cloud Functions, react-router v7, pnpm workspaces.

---

## File structure

**Package renames:**
- `packages/shared/` → `packages/sit-core/` (update `package.json#name` from `@ejm/shared` to `@ejm/sit-core`; update all imports across `apps/web`, `apps/functions`, `packages/shared-functions`)

**New package:**
- `packages/study-core/` — new pnpm workspace package. Contains `TutorProfile`, `SubjectOffering`, `LocationPref` (moved from `apps/study-functions/src/types/{tutor,subject}.ts`).

**New shared-core types:**
- `packages/shared-core/src/types/user.ts` — REWRITE. Drop `UserBase`/`ServiceProviderBase`. Add generic `User` with `profiles` map; add `ProfileBase`; add `ParentProfile`.
- `packages/shared-core/src/types/index.ts` — export the new types; remove old `UserBase`/`ServiceProviderBase`/`ParentUser`/`AdminUser` exports.

**New per-app types:**
- `packages/sit-core/src/types/babysitterProfile.ts` (new file). Replaces/inverts the role discriminant from the old `BabysitterUser`.
- `packages/sit-core/src/types/user.ts` (MODIFY existing). Add `SitUser = User & { profiles: { babysitter?: BabysitterProfile; parent?: ParentProfile } }`. Remove old `BabysitterUser`/`ParentUser`/`AdminUser`/`UserDoc` union (or keep as deprecated re-exports during transition).
- `packages/study-core/src/types/tutorProfile.ts` (new). Same shape as TutorUser but no role discriminant.
- `packages/study-core/src/types/user.ts` (new). `StudyUser = User & { profiles: { tutor?: TutorProfile; parent?: ParentProfile } }`.

**Migration script:**
- `packages/shared-functions/src/admin/migrateUsersToProfiles.ts` (new). Callable. Iterates `users/` collection; for each doc with top-level `role`, writes the corresponding `profiles.{role}` map and deletes the top-level `role` + role-specific fields.

**Modified callables:**
- `apps/functions/src/enrollment/enrollBabysitter.ts` — write `profiles.babysitter` instead of top-level `role` + babysitter fields.
- `apps/functions/src/enrollment/enrollFamily.ts` — write `profiles.parent`.
- `apps/functions/src/enrollment/joinFamily.ts` — same.
- `apps/study-functions/src/enrollment/enrollTutor.ts` — write `profiles.tutor`.

**Modified readers (UI):**
- All `userDoc.role` reads in `apps/web/src/` — replace with `userDoc.profiles.babysitter` / `userDoc.profiles.parent` checks (~17 sites).
- All `userDoc.role` reads in `apps/study-web/src/` — replace similarly.
- `apps/web/src/pages/public/LoginPage.tsx` + `apps/web/src/pages/public/WelcomePage.tsx` (Plan C wrappers): rewrite `postLoginRouter` + `computeRedirect` to check `user.profiles.babysitter`/`user.profiles.parent`.
- Same for sync-study wrappers.

**Modified rules:**
- `firestore.rules` — per-role gates updated. Any rule that checks `request.auth.token.role` or `resource.data.role` rewrites to check the profile slot.

**Modified auth stores:**
- `apps/web/src/stores/authStore.ts` — store narrowed `SitUser | null`. Old `UserDoc` union type goes away.
- `apps/study-web/src/stores/authStore.ts` — store `StudyUser | null`.

**NOT touched:**
- `families/{id}` document shape — Plan D is about users. Families stay as-is; if cross-app family fields become a concern, that's a follow-up.
- Appointment / Engagement / Schedule data — unchanged.
- `AccountStatus` (active/blocked/deleted) stays on `User`. Cross-app block.
- `isAdmin` lives at `User.isAdmin`, NOT in profiles. One admin flag for both apps.

---

## New schema (target state)

```typescript
// packages/shared-core/src/types/user.ts
export interface User {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  status: AccountStatus;
  dateOfBirth?: FirestoreTimestamp;
  photoUrl?: string;
  language: Language;
  notifPrefs: NotifPrefs;
  fcmTokens: string[];
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  lastLoginAt?: FirestoreTimestamp;
  consentAt?: FirestoreTimestamp;
  consentVersion?: string;
  dismissedPwaInstallBanner?: boolean;

  profiles: {
    babysitter?: ProfileBase;  // concrete type narrowed by sit-core/SitUser
    tutor?: ProfileBase;       // concrete type narrowed by study-core/StudyUser
    parent?: ParentProfile;
  };

  isAdmin?: boolean;
}

export interface ProfileBase {
  enrollmentComplete: boolean;
}

export interface ParentProfile extends ProfileBase {
  familyId: string;
  // Future: parent-specific cross-app fields (preferred contact, etc.)
}
```

```typescript
// packages/sit-core/src/types/babysitterProfile.ts
export interface BabysitterProfile extends ProfileBase {
  ejemEmail: string;
  classLevel: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  languages: string[];
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  areaMode: AreaMode;
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: LatLng;
  areaRadiusKm?: number;
  hourlyRate?: number;
  searchable?: boolean;
  lastRevalidatedAt?: FirestoreTimestamp;
  revalidationYear?: number;
}

export interface SitUser extends User {
  profiles: {
    babysitter?: BabysitterProfile;
    parent?: ParentProfile;
  };
}
```

```typescript
// packages/study-core/src/types/tutorProfile.ts
export interface TutorProfile extends ProfileBase {
  ejemEmail: string;
  classLevel: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  languages: string[];
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  areaMode: AreaMode;
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: LatLng;
  areaRadiusKm?: number;
  subjects: SubjectOffering[];
  sessionLengthsMin: number[];
  locationPrefs: LocationPref[];
  paddingMin?: number;
  searchable?: boolean;
}

export interface StudyUser extends User {
  profiles: {
    tutor?: TutorProfile;
    parent?: ParentProfile;
  };
}
```

---

## Migration strategy

Phase ordering within the PR:

1. Code lands first with **dual-read fallback** — every reader prefers `user.profiles.{role}` but falls back to `user.role` if profiles map is absent.
2. Code is deployed to prod (sync-sit only; sync-study is pre-launch).
3. Migration callable runs once against sync-sit prod, lifting each user's top-level `role` + role-specific fields into `profiles.{role}` and deleting the top-level fields.
4. Verification: spot-check sample users; confirm new enrollments write new shape only.
5. Follow-up PR removes the fallback code paths.

Inside the PR, the dual-read fallback is gated by a single helper:

```typescript
// packages/shared-core/src/types/userAdapter.ts
export function readBabysitterProfile(user: User & { role?: string; /* legacy */ }): BabysitterProfile | undefined {
  if (user.profiles?.babysitter) return user.profiles.babysitter as BabysitterProfile;
  if (user.role === 'babysitter') {
    // legacy doc — synthesize a profile from top-level fields
    return synthesizeFromLegacy(user);
  }
  return undefined;
}
```

All consumer code goes through these adapters; removing the fallback is `grep -r readBabysitterProfile`.

---

## Tasks

The work splits into 6 tiers. Each tier finishes with a green build + commit.

### Tier A — package scaffolding (Tasks 1–2)
### Tier B — types (Tasks 3–5)
### Tier C — adapters (Task 6)
### Tier D — writers/callables (Tasks 7–10)
### Tier E — readers (Tasks 11–14)
### Tier F — migration + smoke (Tasks 15–17)

---

## Task 1: Rename `packages/shared` → `packages/sit-core`

**Files:**
- Move directory: `packages/shared/` → `packages/sit-core/`
- Modify: `packages/sit-core/package.json` — change `name` to `@ejm/sit-core`
- Modify: every file in `apps/web/`, `apps/functions/`, `packages/shared-functions/`, `packages/shared-core/` that imports from `@ejm/shared` → import from `@ejm/sit-core`
- Modify: root `pnpm-workspace.yaml` (if it lists packages explicitly)

- [ ] **Step 1: Find all `@ejm/shared` imports**

Run: `grep -rln "@ejm/shared'" apps/ packages/ --include="*.ts" --include="*.tsx"`
Expected: ~30 files.

- [ ] **Step 2: Rename the directory**

```bash
git mv packages/shared packages/sit-core
```

- [ ] **Step 3: Update package.json name**

Edit `packages/sit-core/package.json`:
```diff
- "name": "@ejm/shared",
+ "name": "@ejm/sit-core",
```

- [ ] **Step 4: Search & replace imports**

Run: `find apps packages -name "*.ts" -o -name "*.tsx" | xargs sed -i '' "s/'@ejm\\/shared'/'@ejm\\/sit-core'/g"`

(Verify on a Linux/Mac box first; the `sed -i ''` syntax is BSD. Linux uses `sed -i ''` differently — adjust if needed.)

- [ ] **Step 5: Update workspace deps**

In each consuming `package.json` (apps/web, apps/functions, packages/shared-functions), replace `"@ejm/shared": "workspace:*"` → `"@ejm/sit-core": "workspace:*"`.

- [ ] **Step 6: pnpm install + build**

```bash
pnpm install
pnpm typecheck
pnpm --filter web build
pnpm --filter functions build
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "chore(packages): rename @ejm/shared to @ejm/sit-core"
```

---

## Task 2: Create `packages/study-core` scaffold

**Files:**
- Create: `packages/study-core/package.json`
- Create: `packages/study-core/tsconfig.json`
- Create: `packages/study-core/src/index.ts`
- Create: `packages/study-core/src/types/index.ts`

- [ ] **Step 1: Scaffold package.json**

```json
// packages/study-core/package.json
{
  "name": "@ejm/study-core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ejm/shared-core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "~5.9.3"
  }
}
```

- [ ] **Step 2: tsconfig**

```json
// packages/study-core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Empty barrel**

```typescript
// packages/study-core/src/index.ts
export * from './types/index.js';

// packages/study-core/src/types/index.ts
// (empty for now; populated by Task 5)
export {};
```

- [ ] **Step 4: Install + verify**

```bash
pnpm install
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(packages): scaffold @ejm/study-core"
```

---

## Task 3: Define generic `User` + `ProfileBase` + `ParentProfile` in shared-core

**Files:**
- Modify: `packages/shared-core/src/types/user.ts` — REWRITE
- Modify: `packages/shared-core/src/types/index.ts`

- [ ] **Step 1: Replace user.ts**

(See "New schema (target state)" above for the full file. Drop `UserBase`, `ServiceProviderBase`, the old `ParentUser`/`AdminUser`. Keep them as deprecated re-exports if any external code still imports them, OR delete and accept the build break — Task 5 fixes consumers.)

- [ ] **Step 2: Export from barrel**

```typescript
// packages/shared-core/src/types/index.ts
export * from './common.js';
export * from './user.js';
// remove: export * from './oldUserTypes';
```

- [ ] **Step 3: Typecheck (expect downstream errors)**

Run: `pnpm typecheck`
Expected: FAIL — `sit-core` and `study-functions` reference the removed types. Tasks 4 + 5 fix that.

- [ ] **Step 4: Commit (red build is OK — we land Task 4 immediately)**

```bash
git commit -m "feat(shared-core): introduce generic User entity with profiles map"
```

---

## Task 4: Define `BabysitterProfile` + `SitUser` in sit-core

**Files:**
- Create: `packages/sit-core/src/types/babysitterProfile.ts`
- Modify: `packages/sit-core/src/types/user.ts` — REWRITE
- Modify: `packages/sit-core/src/index.ts`

- [ ] **Step 1: Author BabysitterProfile**

(See "New schema (target state)" above for the full type.)

- [ ] **Step 2: Author SitUser + remove old BabysitterUser/UserDoc**

```typescript
// packages/sit-core/src/types/user.ts
import type { User, ParentProfile } from '@ejm/shared-core';
import type { BabysitterProfile } from './babysitterProfile.js';

export interface SitUser extends User {
  profiles: {
    babysitter?: BabysitterProfile;
    parent?: ParentProfile;
  };
}

// Legacy alias kept during migration window — remove in follow-up PR.
export type UserDoc = SitUser;
```

- [ ] **Step 3: Export from barrel**

```typescript
// packages/sit-core/src/index.ts (or src/types/index.ts)
export * from './types/babysitterProfile.js';
export * from './types/user.js';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS for sit-core; downstream `apps/web` + `apps/functions` may still fail because they read `userDoc.role`. Those break in Tier E.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(sit-core): introduce BabysitterProfile + SitUser narrowed type"
```

---

## Task 5: Move TutorProfile to `study-core` (from `apps/study-functions`)

**Files:**
- Create: `packages/study-core/src/types/tutorProfile.ts`
- Move: `apps/study-functions/src/types/tutor.ts` content → `packages/study-core/src/types/tutorProfile.ts` (sans role discriminator)
- Move: `apps/study-functions/src/types/subject.ts` → `packages/study-core/src/types/subject.ts`
- Modify: `packages/study-core/src/types/index.ts` — export new types
- Modify: `apps/study-functions/src/types/` — delete `tutor.ts`, `subject.ts` (now in study-core)
- Modify: `apps/study-functions/package.json` — add `@ejm/study-core: workspace:*`
- Modify: `apps/study-web/package.json` — add `@ejm/study-core: workspace:*`

- [ ] **Step 1: Move subject.ts**

```bash
git mv apps/study-functions/src/types/subject.ts packages/study-core/src/types/subject.ts
```

- [ ] **Step 2: Author TutorProfile in study-core**

Copy `apps/study-functions/src/types/tutor.ts` content to `packages/study-core/src/types/tutorProfile.ts`. Rename `TutorUser` → `TutorProfile`. Change parent type from `extends ServiceProviderBase` to `extends ProfileBase` (from shared-core). Remove the `role: 'tutor'` discriminator field. Import paths update.

- [ ] **Step 3: Author StudyUser**

```typescript
// packages/study-core/src/types/user.ts
import type { User, ParentProfile } from '@ejm/shared-core';
import type { TutorProfile } from './tutorProfile.js';

export interface StudyUser extends User {
  profiles: {
    tutor?: TutorProfile;
    parent?: ParentProfile;
  };
}
```

- [ ] **Step 4: Update barrel**

```typescript
// packages/study-core/src/types/index.ts
export * from './subject.js';
export * from './tutorProfile.js';
export * from './user.js';
```

- [ ] **Step 5: Update consumers + delete old files**

In `apps/study-functions/src/enrollment/enrollTutor.ts` (and any other consumer of TutorUser), change imports from `'../types/tutor.js'` to `'@ejm/study-core'`. Rename `TutorUser` → `TutorProfile` in usages.

Delete `apps/study-functions/src/types/tutor.ts`.

- [ ] **Step 6: Add workspace deps**

Edit both `apps/study-functions/package.json` and `apps/study-web/package.json`:
```diff
+ "@ejm/study-core": "workspace:*",
```

- [ ] **Step 7: pnpm install + typecheck**

```bash
pnpm install
pnpm typecheck
```
Expected: PASS on study-core; sync-study apps may have downstream errors fixed in Tier E.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(study-core): move TutorProfile + SubjectOffering from study-functions"
```

---

## Task 6: User adapter helper (dual-read fallback)

**Files:**
- Create: `packages/shared-core/src/types/userAdapter.ts`
- Modify: `packages/shared-core/src/types/index.ts` — export

The adapter centralizes the "read profiles.X if present, fall back to top-level role" logic so removing the fallback later is one grep.

- [ ] **Step 1: Author the adapter**

```typescript
// packages/shared-core/src/types/userAdapter.ts
import type { User, ParentProfile } from './user.js';

/**
 * Read the babysitter profile from a User, with fallback to legacy
 * top-level role. To be removed in follow-up PR after migration is verified.
 */
export function getBabysitterProfile(user: User & { role?: string }): { enrollmentComplete: boolean } | undefined {
  if (user.profiles?.babysitter) return user.profiles.babysitter;
  if (user.role === 'babysitter') {
    return { enrollmentComplete: (user as any).enrollmentComplete ?? false };
  }
  return undefined;
}

export function getTutorProfile(user: User & { role?: string }): { enrollmentComplete: boolean } | undefined {
  if (user.profiles?.tutor) return user.profiles.tutor;
  if (user.role === 'tutor') {
    return { enrollmentComplete: (user as any).enrollmentComplete ?? false };
  }
  return undefined;
}

export function getParentProfile(user: User & { role?: string }): ParentProfile | undefined {
  if (user.profiles?.parent) return user.profiles.parent;
  if (user.role === 'parent') {
    return {
      enrollmentComplete: (user as any).enrollmentComplete ?? true,
      familyId: (user as any).familyId ?? '',
    };
  }
  return undefined;
}

export function isAdmin(user: User & { role?: string }): boolean {
  if (user.isAdmin === true) return true;
  if (user.role === 'admin') return true;
  return false;
}
```

(The deeper babysitter/tutor profiles return only `enrollmentComplete` in the fallback path. Code that needs more profile fields can access them via `user.profiles.{role}` directly when available; legacy users without profiles will only have the legacy top-level fields, which are accessed by the old code paths that this adapter is replacing. For the migration window, most call sites only need to know "does this user have a babysitter profile and is enrollment done?" — which is what the fallback returns.)

- [ ] **Step 2: Export**

Add to `packages/shared-core/src/types/index.ts`:
```typescript
export * from './userAdapter.js';
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(shared-core): user adapter helpers with legacy fallback (transitional)"
```

---

## Task 7: Update `enrollBabysitter` callable to write `profiles.babysitter`

**Files:**
- Modify: `apps/functions/src/enrollment/enrollBabysitter.ts`

- [ ] **Step 1: Read current implementation**

Run: `cat apps/functions/src/enrollment/enrollBabysitter.ts`

Note the user doc shape currently being written.

- [ ] **Step 2: Rewrite to new shape**

Build the user doc as:
```typescript
const newUser: SitUser = {
  uid,
  email,
  firstName,
  lastName,
  status: 'active',
  dateOfBirth,
  language,
  notifPrefs: { /* ... */ },
  fcmTokens: [],
  createdAt: now,
  updatedAt: now,
  consentAt: now,
  consentVersion: '1.0',
  profiles: {
    babysitter: {
      enrollmentComplete: false,  // marked true at end of enrollment flow
      ejemEmail,
      classLevel,
      gender,
      languages: [],
      areaMode: 'arrondissement',
    },
  },
};
```

Remove the top-level `role: 'babysitter'` write.

- [ ] **Step 3: Verify build**

```bash
pnpm --filter functions build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(functions): enrollBabysitter writes profiles.babysitter"
```

---

## Task 8: Update `enrollFamily` + `joinFamily` + `removeCoParent` to write `profiles.parent`

**Files:**
- Modify: `apps/functions/src/enrollment/enrollFamily.ts`
- Modify: `apps/functions/src/enrollment/joinFamily.ts`
- Modify: `apps/functions/src/family/removeCoParent.ts` (if it touches role)

Same pattern as Task 7 — write `profiles.parent: { enrollmentComplete: true, familyId }` instead of top-level `role` + `familyId`.

- [ ] **Step 1: Update enrollFamily**
- [ ] **Step 2: Update joinFamily**
- [ ] **Step 3: Verify removeCoParent doesn't need changes (only manipulates familyId on the user, which moves to profiles.parent.familyId)**
- [ ] **Step 4: Verify build**
- [ ] **Step 5: Commit:**
```bash
git commit -m "refactor(functions): enroll/join family writes profiles.parent"
```

---

## Task 9: Update `enrollTutor` callable to write `profiles.tutor`

**Files:**
- Modify: `apps/study-functions/src/enrollment/enrollTutor.ts`

Same pattern. New user doc shape:
```typescript
const newUser: StudyUser = {
  uid, email, firstName, lastName, status: 'active',
  // ...shared fields
  profiles: {
    tutor: {
      enrollmentComplete: true,  // tutor enrollment completes synchronously
      ejemEmail, classLevel, gender,
      languages: [], subjects: [], sessionLengthsMin: [], locationPrefs: [],
      areaMode: 'arrondissement',
    },
  },
};
```

- [ ] **Step 1: Rewrite**
- [ ] **Step 2: Build**
- [ ] **Step 3: Commit:**
```bash
git commit -m "refactor(study-functions): enrollTutor writes profiles.tutor"
```

---

## Task 10: Migration callable

**Files:**
- Create: `packages/shared-functions/src/admin/migrateUsersToProfiles.ts`
- Modify: `packages/shared-functions/src/index.ts` — export

Admin-only callable that iterates `users/` and lifts each doc's legacy role into the right `profiles.{babysitter|parent}` slot, then deletes the top-level role + role-specific fields.

- [ ] **Step 1: Implement migration**

```typescript
// packages/shared-functions/src/admin/migrateUsersToProfiles.ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

interface LegacyUser {
  uid: string;
  role?: 'babysitter' | 'parent' | 'tutor' | 'admin';
  enrollmentComplete?: boolean;
  familyId?: string;
  ejemEmail?: string;
  classLevel?: string;
  // ... any legacy fields we lift
}

export const migrateUsersToProfiles = onCall(
  { region: 'europe-west1' },
  async (req) => {
    if (!req.auth?.token.isAdmin) {
      throw new HttpsError('permission-denied', 'admin only');
    }
    const db = getFirestore();
    const snap = await db.collection('users').get();
    let migrated = 0, skipped = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as LegacyUser;
      if (!data.role) { skipped++; continue; }  // already migrated or never had role
      const updates: Record<string, unknown> = {
        profiles: {},
        role: FieldValue.delete(),
      };
      if (data.role === 'babysitter') {
        updates.profiles = { babysitter: synthesizeBabysitterProfile(data) };
      } else if (data.role === 'parent') {
        updates.profiles = { parent: { enrollmentComplete: data.enrollmentComplete ?? true, familyId: data.familyId ?? '' } };
        updates.familyId = FieldValue.delete();
      } else if (data.role === 'tutor') {
        updates.profiles = { tutor: synthesizeTutorProfile(data) };
      } else if (data.role === 'admin') {
        updates.isAdmin = true;
      }
      await doc.ref.update(updates);
      migrated++;
    }
    return { migrated, skipped };
  }
);

function synthesizeBabysitterProfile(legacy: LegacyUser): unknown {
  return {
    enrollmentComplete: legacy.enrollmentComplete ?? false,
    ejemEmail: legacy.ejemEmail ?? '',
    classLevel: legacy.classLevel ?? '',
    // ... copy all babysitter-specific fields from the legacy doc
  };
}

function synthesizeTutorProfile(legacy: LegacyUser): unknown {
  // Sync-study is pre-launch; expect zero hits, but defined for safety.
  return {
    enrollmentComplete: legacy.enrollmentComplete ?? false,
    ejemEmail: legacy.ejemEmail ?? '',
    classLevel: legacy.classLevel ?? '',
  };
}
```

- [ ] **Step 2: Export**

Add to `packages/shared-functions/src/index.ts`:
```typescript
export { migrateUsersToProfiles } from './admin/migrateUsersToProfiles.js';
```

- [ ] **Step 3: Wire into deployment**

In `apps/functions/src/index.ts`, re-export to make it deployable:
```typescript
export { migrateUsersToProfiles } from '@ejm/shared-functions';
```

- [ ] **Step 4: Build**

```bash
pnpm --filter functions build
```

- [ ] **Step 5: Commit:**
```bash
git commit -m "feat(shared-functions): migrateUsersToProfiles admin callable"
```

---

## Task 11: Update sync-sit UI readers (replace `userDoc.role` reads)

**Files:**
- Modify: ~17 files in `apps/web/src/` that read `userDoc.role` or `userDoc.enrollmentComplete`

The pattern: replace `userDoc.role === 'babysitter'` checks with `getBabysitterProfile(user)` calls (which uses the dual-read adapter), or with direct `user.profiles.babysitter` checks where the legacy fallback isn't needed.

- [ ] **Step 1: Inventory the read sites**

Run: `grep -rn "userDoc\.role\|userDoc\?.role" apps/web/src/ --include="*.tsx" --include="*.ts" | grep -v __tests__`
Expected: list of ~17 sites.

- [ ] **Step 2: Rewrite each site**

For each match, replace:
```typescript
if (userDoc?.role === 'babysitter') { ... }
```
with:
```typescript
import { getBabysitterProfile } from '@ejm/shared-core';
if (userDoc && getBabysitterProfile(userDoc)) { ... }
```

(Or for components that don't care about the legacy path: `if (userDoc?.profiles.babysitter) { ... }`.)

Specifically update:
- `apps/web/src/pages/public/WelcomePage.tsx` — `computeRedirect`
- `apps/web/src/pages/public/LoginPage.tsx` — `postLoginRouter`
- `apps/web/src/layouts/BabysitterLayout.tsx`
- `apps/web/src/layouts/FamilyLayout.tsx`
- `apps/web/src/layouts/AdminLayout.tsx`
- ... (all 17 sites)

- [ ] **Step 3: Update authStore narrowed type**

Change `useAuthStore`'s `userDoc: UserDoc | null` to `userDoc: SitUser | null`. (UserDoc was aliased to SitUser in Task 4, so this is a free rename.)

- [ ] **Step 4: Build + typecheck**

```bash
pnpm --filter web build
pnpm typecheck
```

- [ ] **Step 5: Commit:**
```bash
git commit -m "refactor(web): consumers read profiles.babysitter/parent via adapter"
```

---

## Task 12: Update sync-study UI readers

Same pattern as Task 11. Sites:
- `apps/study-web/src/pages/public/WelcomePage.tsx` (Plan C wrapper)
- `apps/study-web/src/pages/public/LoginPage.tsx` (Plan C wrapper)
- Any other reader.

- [ ] **Step 1: Inventory + rewrite**
- [ ] **Step 2: Update authStore to `StudyUser | null`**
- [ ] **Step 3: Build + typecheck**
- [ ] **Step 4: Commit:**
```bash
git commit -m "refactor(study-web): consumers read profiles.tutor/parent via adapter"
```

---

## Task 13: Update Cloud Function readers

**Files:**
- Modify: any callable or trigger in `apps/functions/src/`, `apps/study-functions/src/`, or `packages/shared-functions/src/` that reads `user.role`

Same adapter pattern (`getBabysitterProfile`, etc.) or direct `user.profiles.X` checks.

- [ ] **Step 1: Grep**
- [ ] **Step 2: Rewrite each site**
- [ ] **Step 3: Build all functions**

```bash
pnpm --filter functions build && pnpm --filter study-functions build
```

- [ ] **Step 4: Commit:**
```bash
git commit -m "refactor(functions): cloud function readers use profile adapter"
```

---

## Task 14: Update `firestore.rules`

**Files:**
- Modify: `firestore.rules`

Rewrite gates that reference `request.auth.token.role` or `resource.data.role`. Use `resource.data.profiles.babysitter`, etc.

For example:
```diff
- allow read: if request.auth.token.role == 'babysitter';
+ allow read: if resource.data.profiles.babysitter != null;
```

Note: custom claims aren't updated by the migration. The `request.auth.token.role` checks need to either:
- Migrate to checking `resource.data` (server-trusted user doc state)
- Add a new admin callable that re-issues custom claims based on profile presence

For Plan D scope, prefer `resource.data.profiles.X` checks. Custom-claims rework is a follow-up.

- [ ] **Step 1: Audit firestore.rules**

Run: `grep -n "role" firestore.rules`

- [ ] **Step 2: Rewrite gates**
- [ ] **Step 3: Test against emulator rules suite**

```bash
pnpm test:rules  # or whatever the project uses
```

- [ ] **Step 4: Commit:**
```bash
git commit -m "refactor(rules): role gates check profiles map instead of top-level role"
```

---

## Task 15: Full integration smoke

- [ ] **Step 1: Start emulators**

```bash
pnpm emulators
```

- [ ] **Step 2: New sync-sit babysitter enrollment**

Walk the babysitter enrollment flow on dev. After completion, inspect the user doc via Firebase Emulator UI (http://localhost:4000) — confirm shape:
```json
{
  "uid": "...",
  "profiles": { "babysitter": { ... } },
  "isAdmin": null or missing,
  "role": null or missing
}
```

- [ ] **Step 3: New sync-sit family enrollment**

Same — confirm `profiles.parent` exists.

- [ ] **Step 4: New sync-study tutor enrollment**

Confirm `profiles.tutor` exists.

- [ ] **Step 5: Login as legacy user (manually seed a legacy-shape doc)**

Create a doc in Firestore Emulator UI with `{ uid, role: 'babysitter', enrollmentComplete: true }`. Log in via the dev UI. Confirm the BabysitterDashboard renders (adapter falls back correctly).

- [ ] **Step 6: Run migration callable**

Trigger `migrateUsersToProfiles` via the emulator's functions UI. Verify the seeded legacy user is now in new shape.

- [ ] **Step 7: Cross-app smoke**

Manually seed a user with both `profiles.babysitter` and `profiles.tutor`. Confirm sync-sit's `/login` routes them to `/babysitter` AND sync-study's `/login` routes them to `/tutor`.

---

## Task 16: Push + open PR

- [ ] **Step 1: Push**
- [ ] **Step 2: Open PR**

PR body summarizes the schema change, the migration steps, and the deferred follow-ups (remove fallback adapter, rework custom claims).

---

## Test coverage analysis

- **Covered by build/typecheck:** all type structure changes.
- **Covered by integration smoke:** new enrollments (all 3 roles), legacy doc compatibility, migration run, cross-app login.
- **Not covered:** existing test suite is already broken on main (Plan C noted this). Adding new tests is out of scope for this PR but should be a follow-up.
- **Gaps:** custom-claims-based rule gates (if any exist) need a separate path. Plan D handles `resource.data.role` gates only.

## Security risks

- **Migration runs with admin privileges** — gated behind `req.auth.token.isAdmin`. Must verify the deployer has the admin custom claim before running.
- **Atomicity** — the migration writes per-doc with `FieldValue.delete()` for legacy fields. A failed update mid-script leaves the user partially migrated. Mitigation: each user update is atomic at the doc level. Re-running the script picks up where it left off (skipped users already have `profiles` map and no `role` field).
- **Rule gate inversion risk** — if any rule was previously "anyone whose role is admin can read X" and the rule now checks `resource.data.profiles.X`, double-check the gate doesn't accidentally widen. Specifically: admin operations should now check `resource.data.isAdmin` not profile presence.
- **Custom claims** — Firebase Auth custom claims (`request.auth.token.role`) are stale after migration. Any rule reading `request.auth.token.role` will fail for migrated users. Follow-up PR refreshes claims.

## Future upgrades / refactoring

- Plan E (shared app shells) can now use the unified `User` shape across both apps.
- Follow-up PR removes the dual-read fallback (`getBabysitterProfile` etc.) once prod migration is verified.
- Follow-up PR refreshes custom claims based on new profile shape (if any rules still depend on claims).
- Long-term: `families/{id}` doc may benefit from a similar `profiles.{sit,study}` split if cross-app family fields proliferate.
- Long-term: the `dateOfBirth`, `gender`, `languages` fields are currently duplicated between `BabysitterProfile` and `TutorProfile`. Could be lifted to `User` if we observe they're always the same person-level fact (likely true — they're EJM-student identity).
