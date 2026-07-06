# Cross-App Enrollment (Backend Contract, PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every enrollment callable (enrollTutor, enrollBabysitter, enrollFamily, joinFamily) gains an authenticated "add-profile" mode that merges the new `profiles.{key}` into the caller's existing `users/{uid}` doc instead of failing with `already-exists`, so an existing sync-sit user can become a sync-study tutor and vice versa.

**Architecture:** A shared helper module `packages/shared-functions/src/enrollment/addProfileToUser.ts` owns the merge semantics (transaction, status gate, profile-collision check, fill-absent-base-fields). Each callable branches on `request.auth`: authed → merge path; unauthed → existing create path, with `already-exists` errors gaining `details: { reason: 'account-exists' }` so UIs (PR 2) can show a login CTA. `verifyEjmEmail` stops rejecting the caller's own email. No firestore.rules changes (Admin SDK bypasses `profileRolesUnchanged`, which correctly keeps blocking client-side profile adds).

**Tech Stack:** Firebase Cloud Functions v2 onCall (europe-west1), Firestore Admin SDK, zod, vitest integration tests against the Firebase emulators (`tests/integration/`).

**Scope guard:** Backend + integration tests only. Wizard UIs, routing hardening, and i18n are PR 2 (separate plan). Existing unauthed behavior must not change except for the added `details` payload on errors.

**Decisions locked in the approved milestone plan** (do not relitigate):
- Add-profile mode triggers on `request.auth` being present.
- Error contract: code stays `already-exists`; `details.reason` is `'account-exists'` (unauth, email taken) or `'profile-exists'` (authed, profile already present).
- EJM-email verification codes are still required in add-profile mode for babysitter/tutor (community vetting); the verified `ejemEmail` lands inside the new profile; the account email is untouched. Parent flows skip code verification when authed; `joinFamily` still validates the invite token.
- Base-field merge: existing doc wins; wizard values fill only absent fields. Top-level `consentAt`/`consentVersion` are NOT overwritten; second-app consent goes in the audit log details.
- `status !== 'active'` → `permission-denied`.
- `schedules/{uid}` is one per-user doc shared by both apps: create-if-missing, never clobber.

---

## Task 1: Surface `error.details` in the test harness

**Files:**
- Modify: `tests/setup/emulator.ts:100-110` (the `callFunction` error branch)

- [ ] **Step 1: Extend the thrown error with `details`**

In `callFunction`, the error construction currently reads:

```ts
  if (body.error) {
    const err = new Error(body.error.message || 'Function error') as Error & {
      code: string;
      status: string;
    };
    err.code = body.error.status;
    err.status = body.error.status;
    throw err;
  }
```

Replace with:

```ts
  if (body.error) {
    const err = new Error(body.error.message || 'Function error') as Error & {
      code: string;
      status: string;
      details?: unknown;
    };
    err.code = body.error.status;
    err.status = body.error.status;
    err.details = body.error.details;
    throw err;
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ejm/tests typecheck` (if no such script, `npx tsc --noEmit -p tests` from repo root; check `tests/package.json` scripts first)
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add tests/setup/emulator.ts
git commit -m "test(harness): surface HttpsError details in callFunction"
```

---

## Task 2: Shared merge helper `addProfileToUser`

**Files:**
- Create: `packages/shared-functions/src/enrollment/addProfileToUser.ts`
- Modify: `packages/shared-functions/src/index.ts` (add export)

No standalone unit tests: the helper is pure Firestore I/O and `@ejm/shared-functions` has no unit-test harness (PR #74 removes it); behavior is covered exhaustively by the integration tests in Tasks 4–7.

- [ ] **Step 1: Write the helper**

Create `packages/shared-functions/src/enrollment/addProfileToUser.ts`:

```ts
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

export type ProfileKey = 'babysitter' | 'tutor' | 'parent';

export interface AddProfileParams {
  uid: string;
  profileKey: ProfileKey;
  profileData: Record<string, unknown>;
  /** Written only when the field is absent on the existing doc. */
  fillBaseFields?: Record<string, unknown>;
  auditAction: string;
  auditDetails?: Record<string, unknown>;
}

function assertAddable(snap: DocumentSnapshot, profileKey: ProfileKey): void {
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'User record not found');
  }
  const data = snap.data()!;
  if (data.status !== 'active') {
    throw new HttpsError('permission-denied', 'Account is not active');
  }
  if (data.profiles?.[profileKey] !== undefined) {
    throw new HttpsError(
      'already-exists',
      `This account already has a ${profileKey} profile`,
      { reason: 'profile-exists', profile: profileKey },
    );
  }
}

/**
 * Read-only preflight with the same checks as addProfileToUser. Callables
 * that create sibling documents first (enrollFamily creates the family doc
 * before the profile merge) call this to avoid orphans on a doomed merge.
 */
export async function assertCanAddProfile(uid: string, profileKey: ProfileKey): Promise<void> {
  const snap = await db.collection('users').doc(uid).get();
  assertAddable(snap, profileKey);
}

/**
 * Merge profiles.{key} into an existing users/{uid} doc. The existing doc
 * wins for base fields: entries in fillBaseFields are written only when the
 * field is absent. Consent is deliberately NOT touched — record the new
 * app's consent version in auditDetails instead.
 */
export async function addProfileToUser(params: AddProfileParams): Promise<void> {
  const ref = db.collection('users').doc(params.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    assertAddable(snap, params.profileKey);
    const data = snap.data()!;
    const update: Record<string, unknown> = {
      [`profiles.${params.profileKey}`]: params.profileData,
      updatedAt: new Date(),
    };
    for (const [field, value] of Object.entries(params.fillBaseFields ?? {})) {
      if (data[field] === undefined && value !== undefined) {
        update[field] = value;
      }
    }
    tx.update(ref, update);
  });
  await writeUserActivity(params.uid, params.auditAction, params.auditDetails ?? {});
}

/**
 * Create the empty schedules/{uid} grid if it doesn't exist. schedules/{uid}
 * is a single per-user doc shared by both apps (babysitter and tutor
 * availability) — an existing grid must never be clobbered.
 */
export async function ensureScheduleDoc(uid: string): Promise<void> {
  const emptySlots = new Array(96).fill(false);
  try {
    await db.collection('schedules').doc(uid).create({
      userId: uid,
      weekly: {
        mon: emptySlots,
        tue: emptySlots,
        wed: emptySlots,
        thu: emptySlots,
        fri: emptySlots,
        sat: emptySlots,
        sun: emptySlots,
      },
      overrides: {},
      holidayMode: 'same',
      updatedAt: new Date(),
    });
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 6) return; // gRPC 6 = ALREADY_EXISTS
    throw err;
  }
}
```

- [ ] **Step 2: Export from the package index**

In `packages/shared-functions/src/index.ts`, next to the other enrollment exports (`export { enrollFamily } ...`), add:

```ts
export {
  addProfileToUser,
  assertCanAddProfile,
  ensureScheduleDoc,
} from './enrollment/addProfileToUser.js';
export type { AddProfileParams, ProfileKey } from './enrollment/addProfileToUser.js';
```

- [ ] **Step 3: Build**

Run: `pnpm --filter @ejm/shared-core build && pnpm --filter @ejm/sit-core build && pnpm --filter @ejm/shared-functions build`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add packages/shared-functions/src/enrollment/addProfileToUser.ts packages/shared-functions/src/index.ts
git commit -m "feat(shared-functions): addProfileToUser merge helper for cross-app enrollment"
```

---

## Task 3: `verifyEjmEmail` — allow the caller's own email

**Files:**
- Modify: `packages/shared-functions/src/auth/verifyEjmEmail.ts:36-45`
- Create: `tests/integration/enrollment/verify-ejm-email.test.ts`

Why: a sync-sit babysitter's account email IS their EJM email, so today `verifyEjmEmail` rejects them at tutor-wizard step 0 with `already-exists` before `enrollTutor` is ever reached.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/enrollment/verify-ejm-email.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('verifyEjmEmail cross-app cases', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    // Preapprove the babysitter's email so EJM domain validation is skipped
    // (test emails are not on the EJM domain).
    const db = getDb();
    await db
      .collection('preapprovedEmails')
      .doc(seed.babysitter1.email.toLowerCase())
      .set({ used: false });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('authenticated user can request a code for their own account email', async () => {
    const token = await getIdToken(seed.babysitter1.uid);
    const result = await callFunction<{ success: boolean }>(
      'verifyEjmEmail',
      { email: seed.babysitter1.email },
      token,
    );
    expect(result.success).toBe(true);

    const codeDoc = await getDb()
      .collection('verificationCodes')
      .doc(seed.babysitter1.email.toLowerCase())
      .get();
    expect(codeDoc.exists).toBe(true);
  });

  it("authenticated user cannot request a code for someone else's account email", async () => {
    const token = await getIdToken(seed.parent1.uid);
    await expect(
      callFunction('verifyEjmEmail', { email: seed.babysitter1.email }, token),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('unauthenticated request for an existing email is still rejected with account-exists details', async () => {
    await expect(
      callFunction('verifyEjmEmail', { email: seed.babysitter1.email }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });
});
```

NOTE: assert the exact `err.code` casing by checking an existing test that matches on rejected callable codes (e.g. `tests/integration/enrollment/invite-link.test.ts`) — the emulator returns the status string (`ALREADY_EXISTS`); adjust `toMatchObject` values to that convention.

- [ ] **Step 2: Run it to make sure it fails**

Build + start emulators (see Verification section for the standing recipe), then:
Run: `cd tests && ../node_modules/.bin/vitest run integration/enrollment/verify-ejm-email.test.ts`
Expected: FAIL — case 1 rejects with ALREADY_EXISTS (own email currently blocked), case 3 has no `details`.

- [ ] **Step 3: Implement**

In `packages/shared-functions/src/auth/verifyEjmEmail.ts`, replace lines 36-45:

```ts
    // Check if the email already belongs to an account. An authenticated
    // caller may verify their OWN account email (cross-app add-profile:
    // e.g. a babysitter whose account email is their EJM email enrolling
    // as a tutor) — anyone else's email is still rejected.
    const existingUsers = await db
      .collection('users')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();

    if (!existingUsers.empty && existingUsers.docs[0].id !== request.auth?.uid) {
      throw new HttpsError('already-exists', 'An account with this email already exists', {
        reason: 'account-exists',
      });
    }
```

- [ ] **Step 4: Rebuild functions codebases, restart emulators, run the test**

Run: `pnpm --filter @ejm/shared-functions build && pnpm --filter functions build && pnpm --filter study-functions build`, restart emulators, then re-run the vitest command from Step 2.
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add packages/shared-functions/src/auth/verifyEjmEmail.ts tests/integration/enrollment/verify-ejm-email.test.ts
git commit -m "feat(auth): verifyEjmEmail allows authenticated caller's own email"
```

---

## Task 4: `enrollTutor` add-profile mode

**Files:**
- Modify: `apps/study-functions/src/enrollment/enrollTutor.ts`
- Create: `tests/integration/enrollment/cross-app-enroll-tutor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/enrollment/cross-app-enroll-tutor.test.ts`. Verification codes are seeded directly in Firestore (the callable only reads the `verificationCodes` doc; `verifyEjmEmail` is not under test here):

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const EJEM_EMAIL = 'crossapp.tutor@ejm-test.org';
const CODE = '123456';

function tutorEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Wizard',
    lastName: 'Value',
    dateOfBirth: '2007-03-15',
    classLevel: 'CP',
    subjects: [{ subject: 'math', levels: ['CP'], rate: 20 }],
    sessionLengthsMin: [60],
    locationPrefs: ['online'],
    paddingMin: 15,
    contactEmail: 'contact@test.com',
    areaMode: 'arrondissement',
    arrondissements: ['75001'],
    ...overrides,
  };
}

async function seedCode(email: string) {
  await getDb()
    .collection('verificationCodes')
    .doc(email.toLowerCase())
    .set({
      code: CODE,
      email: email.toLowerCase(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      createdAt: new Date(),
    });
}

describe('enrollTutor cross-app add-profile', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    await seedCode(EJEM_EMAIL);
  });

  it('adds profiles.tutor to an authed sit parent; parent profile and base fields intact', async () => {
    const token = await getIdToken(seed.parent1.uid);
    const before = (await getDb().collection('users').doc(seed.parent1.uid).get()).data()!;

    const result = await callFunction<{ uid: string }>(
      'enrollTutor',
      {
        ejemEmail: EJEM_EMAIL,
        verificationCode: CODE,
        consentVersion: '1.0',
        enrollment: tutorEnrollment(),
      },
      token,
    );
    expect(result.uid).toBe(seed.parent1.uid);

    const after = (await getDb().collection('users').doc(seed.parent1.uid).get()).data()!;
    // New tutor profile with the verified EJM email inside it
    expect(after.profiles.tutor.ejemEmail).toBe(EJEM_EMAIL.toLowerCase());
    expect(after.profiles.tutor.enrollmentComplete).toBe(false);
    expect(after.profiles.tutor.subjects).toHaveLength(1);
    // Existing profile untouched
    expect(after.profiles.parent).toEqual(before.profiles.parent);
    // Existing base fields win over conflicting wizard values
    expect(after.firstName).toBe(before.firstName);
    expect(after.email).toBe(before.email);
    // Consent not overwritten
    expect(after.consentVersion).toBe(before.consentVersion);
    // Code consumed
    const codeDoc = await getDb()
      .collection('verificationCodes')
      .doc(EJEM_EMAIL.toLowerCase())
      .get();
    expect(codeDoc.exists).toBe(false);
  });

  it('does not clobber an existing schedules grid', async () => {
    // parent1 got a tutor profile in the previous test; use babysitter1 who
    // has a seeded schedule with a marked slot.
    const db = getDb();
    const slotBefore = (await db.collection('schedules').doc(seed.babysitter1.uid).get()).data();

    const token = await getIdToken(seed.babysitter1.uid);
    await callFunction(
      'enrollTutor',
      {
        ejemEmail: EJEM_EMAIL,
        verificationCode: CODE,
        consentVersion: '1.0',
        enrollment: tutorEnrollment(),
      },
      token,
    );

    const slotAfter = (await db.collection('schedules').doc(seed.babysitter1.uid).get()).data();
    expect(slotAfter!.weekly).toEqual(slotBefore!.weekly);
  });

  it('rejects when the caller already has a tutor profile (profile-exists)', async () => {
    const token = await getIdToken(seed.parent1.uid); // gained tutor profile above
    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: EJEM_EMAIL,
          verificationCode: CODE,
          consentVersion: '1.0',
          enrollment: tutorEnrollment(),
        },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists', profile: 'tutor' },
    });
  });

  it('unauthenticated with an existing auth email gets account-exists and no second auth user', async () => {
    await seedCode(seed.parent2.email);
    await expect(
      callFunction('enrollTutor', {
        ejemEmail: seed.parent2.email,
        verificationCode: CODE,
        password: 'Str0ngPass',
        consentVersion: '1.0',
        enrollment: tutorEnrollment(),
      }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });

  it('blocked account cannot add a profile', async () => {
    const db = getDb();
    const uid = 'blocked-user-1';
    await db.collection('users').doc(uid).set({
      uid,
      email: 'blocked@test.com',
      status: 'blocked',
      profiles: { parent: { enrollmentComplete: true, familyId: 'f-x' } },
    });
    const token = await getIdToken(uid);
    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: EJEM_EMAIL,
          verificationCode: CODE,
          consentVersion: '1.0',
          enrollment: tutorEnrollment(),
        },
        token,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('add-profile mode still enforces the verification code', async () => {
    const token = await getIdToken(seed.parent2.uid);
    await expect(
      callFunction(
        'enrollTutor',
        {
          ejemEmail: EJEM_EMAIL,
          verificationCode: '999999',
          consentVersion: '1.0',
          enrollment: tutorEnrollment(),
        },
        token,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
```

NOTES for the implementer:
- Check `tests/setup/seed.ts` for the actual `SeedData` fields (`parent1.email`, `babysitter1.uid`, whether babysitter schedules are seeded — if seed does NOT create a schedules doc with a marked slot, seed one in the test before calling: `db.collection('schedules').doc(seed.babysitter1.uid).set({ userId, weekly: { ...mon has one true slot... }, overrides: {}, holidayMode: 'same', updatedAt: new Date() })`).
- `getIdToken` for `blocked-user-1` requires an Auth emulator user with that uid; check how `getIdToken` works in `tests/setup/emulator.ts` — if it needs a pre-created auth user, create one via `getAuth().createUser({ uid, email })` in the test.
- Match error-code casing to the existing convention in `tests/integration/enrollment/invite-link.test.ts`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ../node_modules/.bin/vitest run integration/enrollment/cross-app-enroll-tutor.test.ts`
Expected: FAIL — authed calls currently die at password validation / `auth/email-already-exists`.

- [ ] **Step 3: Implement the authed branch**

Rewrite `apps/study-functions/src/enrollment/enrollTutor.ts`:

1. Delete the TODO comment block (lines 10-12).
2. `interface EnrollTutorData` → `password?: string;`
3. Add imports:
```ts
import {
  addProfileToUser,
  ensureScheduleDoc,
} from '@ejm/shared-functions/enrollment/addProfileToUser.js';
```
4. At the top of the handler:
```ts
    const data = request.data as EnrollTutorData;
    const isAddProfile = !!request.auth;
```
5. Wrap step 1 (password validation, lines 27-34) in `if (!isAddProfile) { ... }`.
6. Steps 2–4 (consent, code verification, enrollment zod validation, contact-field check) unchanged for both modes.
7. Extract the tutor profile object (currently inline at lines 126-145) into a const built after `dobTimestamp`, used by both branches:
```ts
    const now = new Date();
    const dobTimestamp = Timestamp.fromDate(new Date(enrollment.dateOfBirth));
    const tutorProfile = {
      enrollmentComplete: false, // false until admin verification completes
      ejemEmail: ejemEmailLower,
      classLevel: enrollment.classLevel,
      gender: enrollment.gender ?? null,
      subjects: enrollment.subjects,
      sessionLengthsMin: enrollment.sessionLengthsMin,
      locationPrefs: enrollment.locationPrefs,
      paddingMin: enrollment.paddingMin,
      aboutMe: enrollment.aboutMe ?? null,
      contactEmail: enrollment.contactEmail ?? null,
      contactPhone: enrollment.contactPhone ?? null,
      whatsapp: enrollment.whatsapp ?? null,
      areaMode: enrollment.areaMode,
      arrondissements: enrollment.arrondissements ?? [],
      areaAddress: enrollment.areaAddress ?? null,
      areaRadiusKm: enrollment.areaRadiusKm ?? null,
      languages: [],
      searchable: true,
    };
```
(`const ejemEmailLower = data.ejemEmail.toLowerCase();` moves up before this.)
8. Authed branch replaces auth-user + doc creation:
```ts
    if (isAddProfile) {
      const uid = request.auth!.uid;
      await addProfileToUser({
        uid,
        profileKey: 'tutor',
        profileData: tutorProfile,
        fillBaseFields: {
          firstName: enrollment.firstName,
          lastName: enrollment.lastName,
          dateOfBirth: dobTimestamp,
        },
        auditAction: 'tutor.profile_added',
        auditDetails: {
          ejemEmail: ejemEmailLower,
          consentVersion: data.consentVersion,
          subjects: enrollment.subjects.map((s) => s.subject),
        },
      });
      await ensureScheduleDoc(uid);
      await codeDoc.ref.delete();
      return { uid };
    }
```
9. Unauthed path: `strongPasswordSchema` already ran; `adminAuth.createUser` catch gains details:
```ts
      if (fbErr.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'An account with this email already exists', {
          reason: 'account-exists',
        });
      }
```
The user-doc `set()` keeps `profiles: { tutor: tutorProfile }`; replace the inline schedule-doc `set()` (lines 154-169) with `await ensureScheduleDoc(uid);`.

- [ ] **Step 4: Rebuild, restart emulators, run the test**

Run: `pnpm --filter @ejm/shared-functions build && pnpm --filter study-functions build`, restart emulators, then the vitest command from Step 2.
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add apps/study-functions/src/enrollment/enrollTutor.ts tests/integration/enrollment/cross-app-enroll-tutor.test.ts
git commit -m "feat(study-functions): enrollTutor add-profile mode for existing users"
```

---

## Task 5: `enrollBabysitter` add-profile mode

**Files:**
- Modify: `apps/functions/src/enrollment/enrollBabysitter.ts`
- Create: `tests/integration/enrollment/cross-app-enroll-babysitter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/enrollment/cross-app-enroll-babysitter.test.ts` following the exact pattern of Task 4 (same `seedCode` helper, same conventions). Seed a standalone tutor-style user directly (sync-study seeding isn't in `seedTestData`):

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken } from '../../setup/emulator.js';
import { getAuth } from 'firebase-admin/auth';
import { getApp } from '../../setup/emulator.js';

const EJEM_EMAIL = 'crossapp.sitter@ejm-test.org';
const CODE = '123456';
const TUTOR_UID = 'standalone-tutor-1';

async function seedCode(email: string) {
  await getDb().collection('verificationCodes').doc(email.toLowerCase()).set({
    code: CODE,
    email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    createdAt: new Date(),
  });
}

describe('enrollBabysitter cross-app add-profile', () => {
  beforeAll(async () => {
    await clearAll();
    const db = getDb();
    await getAuth(getApp()).createUser({ uid: TUTOR_UID, email: 'tutoronly@test.com' });
    await db.collection('users').doc(TUTOR_UID).set({
      uid: TUTOR_UID,
      email: 'tutoronly@test.com',
      firstName: 'Tia',
      lastName: 'Tutor',
      status: 'active',
      language: 'fr',
      profiles: {
        tutor: { enrollmentComplete: true, ejemEmail: 'tutoronly@test.com', searchable: true },
      },
      consentVersion: '1.0',
    });
    // Pre-existing schedule with a marked slot — must survive the merge
    const slots = new Array(96).fill(false);
    const monday = [...slots];
    monday[40] = true;
    await db.collection('schedules').doc(TUTOR_UID).set({
      userId: TUTOR_UID,
      weekly: { mon: monday, tue: slots, wed: slots, thu: slots, fri: slots, sat: slots, sun: slots },
      overrides: {},
      holidayMode: 'same',
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    await seedCode(EJEM_EMAIL);
  });

  it('adds a minimal profiles.babysitter to an authed tutor; tutor profile, base fields, schedule intact', async () => {
    const token = await getIdToken(TUTOR_UID);
    const result = await callFunction<{ success: boolean; uid: string }>(
      'enrollBabysitter',
      { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0' },
      token,
    );
    expect(result.uid).toBe(TUTOR_UID);

    const after = (await getDb().collection('users').doc(TUTOR_UID).get()).data()!;
    expect(after.profiles.babysitter).toEqual({
      enrollmentComplete: false,
      ejemEmail: EJEM_EMAIL.toLowerCase(),
      searchable: false,
    });
    expect(after.profiles.tutor.searchable).toBe(true);
    expect(after.firstName).toBe('Tia');
    expect(after.language).toBe('fr'); // fillBaseFields must NOT overwrite

    const sched = (await getDb().collection('schedules').doc(TUTOR_UID).get()).data()!;
    expect(sched.weekly.mon[40]).toBe(true);
  });

  it('rejects a second babysitter profile (profile-exists)', async () => {
    const token = await getIdToken(TUTOR_UID);
    await expect(
      callFunction(
        'enrollBabysitter',
        { ejemEmail: EJEM_EMAIL, verificationCode: CODE, consentVersion: '1.0' },
        token,
      ),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'profile-exists', profile: 'babysitter' },
    });
  });

  it('unauthenticated with an existing auth email gets account-exists details', async () => {
    await seedCode('tutoronly@test.com');
    await expect(
      callFunction('enrollBabysitter', {
        ejemEmail: 'tutoronly@test.com',
        verificationCode: CODE,
        password: 'Str0ngPass',
        consentVersion: '1.0',
      }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });
});
```

(Adjust `getApp` import if `tests/setup/emulator.ts` exports the auth handle differently — reuse whatever `getIdToken`/seed use.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tests && ../node_modules/.bin/vitest run integration/enrollment/cross-app-enroll-babysitter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Mirror Task 4 in `apps/functions/src/enrollment/enrollBabysitter.ts`:
- `password?: string;` in the interface; wrap password validation in `if (!isAddProfile)`.
- Import `{ addProfileToUser, ensureScheduleDoc }` from `@ejm/shared-functions/enrollment/addProfileToUser.js`.
- After code verification, authed branch:
```ts
    if (isAddProfile) {
      const uid = request.auth!.uid;
      const ejemEmailLower = data.ejemEmail.toLowerCase();
      await addProfileToUser({
        uid,
        profileKey: 'babysitter',
        profileData: {
          enrollmentComplete: false,
          ejemEmail: ejemEmailLower,
          searchable: false,
        },
        fillBaseFields: { language: 'en' },
        auditAction: 'babysitter_profile_added',
        auditDetails: { ejemEmail: ejemEmailLower, consentVersion: data.consentVersion },
      });
      await ensureScheduleDoc(uid);
      await codeDoc.ref.delete();
      return { success: true, uid };
    }
```
- Unauthed catch gains `{ reason: 'account-exists' }` details; replace the inline schedule `set()` (lines 103-117) with `await ensureScheduleDoc(uid);`.

- [ ] **Step 4: Rebuild (`pnpm --filter functions build`), restart emulators, run the test**

Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/enrollment/enrollBabysitter.ts tests/integration/enrollment/cross-app-enroll-babysitter.test.ts
git commit -m "feat(functions): enrollBabysitter add-profile mode for existing users"
```

---

## Task 6: `enrollFamily` add-profile mode

**Files:**
- Modify: `packages/shared-functions/src/enrollment/enrollFamily.ts`
- Create: `tests/integration/enrollment/cross-app-enroll-family.test.ts`

No schema change needed: `familyEnrollmentSchema` (packages/shared-core/src/validation/enrollment.ts:30) already excludes email/password — they're checked separately and simply skipped when authed.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/enrollment/cross-app-enroll-family.test.ts` (same standalone-tutor seeding pattern as Task 5, fresh uid `standalone-tutor-2`):

```ts
// Cases:
// 1. authed tutor + family payload (NO email/verificationCode/password) →
//    family created with parentIds=[uid]; profiles.parent = { enrollmentComplete: true, familyId };
//    profiles.tutor intact; existing firstName wins over payload firstName.
// 2. second call for the same user → ALREADY_EXISTS + details {reason:'profile-exists', profile:'parent'}
//    AND the families collection has no new doc (count unchanged — assert via
//    db.collection('families').get() size before/after).
// 3. unauthed with existing email → ALREADY_EXISTS + details {reason:'account-exists'}
//    (seed a verification code for that email first, as the unauthed path checks it).
```

Write these as full `it()` blocks following Task 5's structure; the authed payload is:

```ts
{
  familyName: 'CrossApp',
  firstName: 'Ignored',
  address: '10 Rue de Rivoli, 75001 Paris',
  latLng: { lat: 48.8606, lng: 2.3376 },
  kids: [{ firstName: 'Kid', age: 7, languages: ['French'] }],
}
```

Also run the pre-existing suite unchanged as a regression gate: `vitest run integration/enrollment/enroll-family.test.ts` must stay green.

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && ../node_modules/.bin/vitest run integration/enrollment/cross-app-enroll-family.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

In `packages/shared-functions/src/enrollment/enrollFamily.ts`:
- Import `{ addProfileToUser, assertCanAddProfile }` from `'./addProfileToUser.js'`.
- `const isAddProfile = !!request.auth;` after parsing data.
- Keep step 0 schema validation for both modes; wrap the password check AND step 1 (code verification, lines 47-70) in `if (!isAddProfile)`. NOTE: `codeDoc` is used at step 7 — scope it accordingly (declare `let codeRef: FirebaseFirestore.DocumentReference | null = null` set inside the unauthed block).
- Replace step 3 (auth-user creation) with:
```ts
    let uid: string;
    if (isAddProfile) {
      uid = request.auth!.uid;
      // Preflight so a doomed merge doesn't leave an orphan family doc.
      await assertCanAddProfile(uid, 'parent');
    } else {
      // existing createUser block, catch gains details { reason: 'account-exists' }
    }
```
- Steps 4-5 (family + kids creation) unchanged.
- Step 6: branch —
```ts
    if (isAddProfile) {
      await addProfileToUser({
        uid,
        profileKey: 'parent',
        profileData: { enrollmentComplete: true, familyId },
        fillBaseFields: {
          firstName: data.firstName,
          lastName: data.lastName || data.familyName,
          language: 'en',
        },
        auditAction: 'family_profile_added',
        auditDetails: { familyId },
      });
    } else {
      // existing users.set() block unchanged
    }
```
- Step 7 (code cleanup) + the `family_enrolled` audit call: unauthed mode only.
- Return `{ success: true, uid, familyId }` in both modes.

- [ ] **Step 4: Rebuild shared-functions + both function codebases, restart emulators, run new + old enroll-family tests**

Expected: PASS both files.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-functions/src/enrollment/enrollFamily.ts tests/integration/enrollment/cross-app-enroll-family.test.ts
git commit -m "feat(shared-functions): enrollFamily add-profile mode for existing users"
```

---

## Task 7: `joinFamily` add-profile mode

**Files:**
- Modify: `packages/shared-functions/src/enrollment/joinFamily.ts`
- Create: `tests/integration/enrollment/cross-app-join-family.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/enrollment/cross-app-join-family.test.ts` (standalone tutor `standalone-tutor-3`; seed a family + inviteLinks doc directly, mirroring `tests/integration/enrollment/invite-link.test.ts` conventions):

```ts
// Cases:
// 1. authed tutor + { token } only (no email/code/password/names) →
//    profiles.parent added with the invite's familyId; families/{id}.parentIds
//    gains uid; invite marked used with usedByUserId=uid; tutor profile intact.
// 2. used token, authed → FAILED_PRECONDITION.
// 3. authed caller who already has a parent profile → ALREADY_EXISTS +
//    details {reason:'profile-exists'} and invite NOT consumed (used stays false).
```

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

In `packages/shared-functions/src/enrollment/joinFamily.ts`:
- Import `{ addProfileToUser }` from `'./addProfileToUser.js'`.
- `const isAddProfile = !!request.auth;`
- Step 0: for authed mode skip `joinFamilySchema` (it requires email/password); only `if (!data.token) throw invalid-argument`.
- Steps 1 + 3 (invite token, family existence): unchanged, both modes.
- Step 2 (code verification) and step 4 (createUser): unauthed only; createUser catch gains `{ reason: 'account-exists' }` details.
- Step 5: branch —
```ts
    if (isAddProfile) {
      const uid = request.auth!.uid;
      await addProfileToUser({
        uid,
        profileKey: 'parent',
        profileData: { enrollmentComplete: true, familyId },
        fillBaseFields: {
          ...(data.firstName ? { firstName: data.firstName } : {}),
          ...(data.lastName ? { lastName: data.lastName } : {}),
          language: 'en',
        },
        auditAction: 'joined_family',
        auditDetails: { familyId },
      });
      // fall through to shared tail with this uid
    } else {
      // existing users.set() block
    }
```
IMPORTANT ordering: `addProfileToUser` runs BEFORE the invite is marked used, so a profile-exists rejection leaves the invite valid (asserted by test case 3).
- Steps 6-7 (arrayUnion parentIds, mark invite used): shared, both modes. Step 8 (code delete) + `joined_family` audit: unauthed only (the authed path audits via addProfileToUser).

- [ ] **Step 4: Rebuild, restart emulators, run new + existing invite-link tests**

Expected: PASS both files.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-functions/src/enrollment/joinFamily.ts tests/integration/enrollment/cross-app-join-family.test.ts
git commit -m "feat(shared-functions): joinFamily add-profile mode for existing users"
```

---

## Task 8: Full gates + PR

- [ ] **Step 1: Full local gates**

```bash
pnpm typecheck
pnpm test:unit
```
Expected: clean / all passing.

- [ ] **Step 2: Full integration + rules suite**

Standing emulator recipe (worktree root):
```bash
pnpm --filter @ejm/shared-core build && pnpm --filter @ejm/sit-core build && \
pnpm --filter @ejm/study-core build && pnpm --filter @ejm/shared-functions build && \
pnpm --filter functions build && pnpm --filter study-functions build
firebase emulators:start --project demo-test > /tmp/emu.log 2>&1 &
# wait for "All emulators ready" in /tmp/emu.log, then:
cd tests && ../node_modules/.bin/vitest run
```
Expected: all files passing (251 pre-existing + the 4-5 new files). Kill emulators after.

NOTE: `firebase emulators:exec` silently no-ops `pnpm --filter` commands on this machine — always use the background `emulators:start` + direct vitest pattern above.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feature/cross-app-enrollment
gh pr create --title "feat: cross-app enrollment — add-profile mode for all enrollment callables" --body "<summary: contract decisions, test matrix, risks (shared schedules grid; consent in audit log only), note that UI is PR 2>"
```

---

## Self-review checklist (run before Task 8)

1. Every callable's UNAUTHED path byte-identical in behavior except added `details` on `already-exists` errors (regression suites: enroll-family, invite-link, plus any enrollment assertions in the wider integration suite).
2. `codeDoc.ref.delete()` runs in add-profile mode for tutor/babysitter (code is consumed) but code verification never runs for authed parent flows.
3. No path writes top-level `consentAt`/`consentVersion` on an existing doc.
4. `assertCanAddProfile` precedes family-doc creation in enrollFamily; `addProfileToUser` precedes invite consumption in joinFamily.
5. All new integration tests pass with the emulator started fresh (no inter-file order dependence: each file `clearAll()`s in beforeAll/afterAll).
