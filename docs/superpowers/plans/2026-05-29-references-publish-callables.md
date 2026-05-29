# References Publish-Path Callables (BL-5 + BL-6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close BL-5 and BL-6 from `docs/agent-runs/agent-9-security-baseline.md` §7 by moving every `references` write that crosses an authorization boundary out of client Firestore writes and into Cloud Function callables that perform server-side relationship and role checks.

**Architecture:** Three new callables — `submitFamilyEndorsement` (parent→babysitter, gated on a confirmed `appointments` lookup), `acceptFamilyEndorsement` (babysitter accepts a private endorsement about themselves; legitimate `private→approved` transition that the rule cannot express), `publishManualReference` (admin promotes a manual reference to `published`; closes the babysitter self-publish fraud vector). After the callables exist, `firestore.rules` is tightened to remove the client-side `family_submitted` create branch entirely, and the client (`useEndorsements`, `EndorsementDialog`, `EndorsementsPage`) is refactored to call the callables instead of writing references directly. Existing manual-self-create by babysitters is retained at the rule layer. Tests are added at both layers: integration (callable behavior + audit log) and rules (positive/negative create/update assertions).

**Tech Stack:** Firebase Cloud Functions v2 (`onCall`, `HttpsError`, region `europe-west1`), Firestore admin SDK, Vitest, `@firebase/rules-unit-testing` for rules harness, React 19 + Firebase Web SDK on the client.

---

## File structure

**New files:**
- `apps/functions/src/references/submitFamilyEndorsement.ts` — parent endorses babysitter; gated on confirmed appointment.
- `apps/functions/src/references/acceptFamilyEndorsement.ts` — babysitter accepts an endorsement about themselves (`private`→`approved`).
- `apps/functions/src/references/publishManualReference.ts` — admin promotes a manual reference to `published`.
- `tests/integration/references/submit-family-endorsement.test.ts`
- `tests/integration/references/accept-family-endorsement.test.ts`
- `tests/integration/references/publish-manual-reference.test.ts`
- `apps/web/src/hooks/useReferenceActions.ts` — thin hook wrapping the three callables for the UI.

**Modified files:**
- `apps/functions/src/index.ts` — export the three new callables.
- `firestore.rules` — remove the `type=='family_submitted'` branch from the `references` create rule.
- `tests/rules/firestore-rules.test.ts` — add positive/negative tests for the tightened create rule.
- `apps/web/src/hooks/useEndorsements.ts` — remove `publishReference` and `unpublishReference` (orphaned by the rule tightening; their UI affordance was already hidden in Phase -1).
- `apps/web/src/hooks/__tests__/useEndorsements.behavior.test.ts` — remove tests asserting `publishReference`/`unpublishReference` behavior.
- `apps/web/src/components/endorsements/EndorsementDialog.tsx` — replace the create-path `addDoc(collection(db, 'references'), …)` with `submitFamilyEndorsement` callable; edit-path stays client-side (rules already permit it).
- `apps/web/src/pages/babysitter/EndorsementsPage.tsx` — remove now-dead publish/unpublish handlers; wire `acceptFamilyEndorsement` to a new "Accept" button on family-submitted endorsements that are still `private`.
- `apps/web/src/i18n/locales/en.json` + `fr.json` — add `references.acceptButton`, `references.endorsementAccepted` strings.

**Files NOT touched (by design):**
- `apps/functions/src/references/onReferenceCreated.ts` — the existing trigger fires regardless of whether the create comes from a client or a callable. No change.
- The `references` update rule — already correctly denies `status` transitions to `approved`/`published` from the client; tightening it further has no marginal value once the create branch is removed and the only legit promotion paths go through callables.
- The babysitter manual-self-create flow (rule + UI) — manual references stay client-writable per the baseline's allowed branch.

---

## Background

Read first (none repeated below):
- `docs/agent-runs/agent-9-security-baseline.md` §7 entries `[BLOCK-LATER-5]` and `[BLOCK-LATER-6]` — the binding statements of the problem.
- `firestore.rules` `match /references/{referenceId}` block, lines roughly 78–115 — the current rule that's being tightened.
- `apps/web/src/hooks/useEndorsements.ts` — current client API; `publishReference`/`unpublishReference` are removed and `acceptFamilyEndorsement` is added (via `useReferenceActions`).
- `apps/functions/src/appointments/respondToRequest.ts` — pattern for an `onCall` callable that does a Firestore relationship check + audit log + region.
- `apps/functions/src/admin/verifyAdmin.ts` — admin role check used in the publish callable.
- `apps/functions/src/admin/writeAuditLog.ts` — `writeAuditLog` + `writeUserActivity` helpers.

Every server file uses `region: 'europe-west1'` and `cors: getCorsOrigin()`. Every callable starts with the auth/uid guard:

```typescript
if (!request.auth) {
  throw new HttpsError('unauthenticated', 'Must be logged in');
}
const uid = request.auth.uid;
```

---

## Task 1: `submitFamilyEndorsement` callable

**Files:**
- Create: `apps/functions/src/references/submitFamilyEndorsement.ts`
- Create: `tests/integration/references/submit-family-endorsement.test.ts`
- Modify: `apps/functions/src/index.ts` (add export at the end of the references block, after `notifyOnNewReference`)

**Inputs (TypeScript shape):**

```typescript
interface SubmitFamilyEndorsementData {
  babysitterUserId: string;
  appointmentId: string;
  referenceText: string;          // min 10 chars after trim
  refName: string;                // submitter's display name on the endorsement
  refPhone?: string | null;
  refWhatsapp?: string | null;
  refEmail?: string | null;
  numberOfKids?: number | null;
  kidAges?: number[] | null;
}
```

**Server-derived fields (NEVER trusted from client):**
- `submittedByUserId = uid`
- `submittedByFamilyId = caller's familyId` (read from `users/{uid}`)
- `isEjmFamily = families/{familyId}.verification.isFullyVerified` (read from server, NOT from client input)
- `type = 'family_submitted'` (forced)
- `status = 'private'` (forced)
- `createdAt = FieldValue.serverTimestamp()`
- `updatedAt = FieldValue.serverTimestamp()`
- `referenceId = <docId>` (written back after create)

**Validation order (fail fast):**
1. Auth present (`unauthenticated`).
2. All required fields present and non-empty (`invalid-argument`).
3. `referenceText.trim().length >= 10` (`invalid-argument`).
4. `data.babysitterUserId !== uid` (`invalid-argument` — cannot endorse self).
5. Caller's `users/{uid}` doc exists and has `role === 'parent'` and a non-empty `familyId` (`permission-denied`).
6. `appointments/{appointmentId}` doc exists (`not-found`).
7. Appointment doc has `familyId === caller's familyId`, `babysitterUserId === data.babysitterUserId`, AND `status === 'confirmed'` (`permission-denied` — single message "Endorsement requires a confirmed appointment with this babysitter").
8. No existing reference exists with the same `(submittedByUserId, babysitterUserId, appointmentId)` triple (`already-exists` — prevent duplicates).

Tests assert each branch. The `permission-denied` cases must use exactly that string code so the client can map to a localized message.

- [ ] **Step 1: Add `SubmitFamilyEndorsementData` to seed/test helpers (no change to setup yet, just confirm presence of `seedAppointment` with `status: 'confirmed'`)**

Run: `grep -A 3 "export async function seedAppointment" tests/setup/seed.ts`
Expected output includes `status: data.status ?? 'pending'` — confirming the helper supports overriding status to `'confirmed'`.

- [ ] **Step 2: Write the failing integration test file**

Create `tests/integration/references/submit-family-endorsement.test.ts`:

```typescript
/**
 * Integration tests for submitFamilyEndorsement callable (BL-5).
 *
 * The callable is the only legitimate way for a parent to create a
 * family_submitted reference. The rule layer no longer accepts the
 * family_submitted branch — see firestore.rules and rules tests.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb, getIdToken, callCallable } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('submitFamilyEndorsement callable', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const snap = await db.collection('references').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    const apts = await db.collection('appointments').get();
    await Promise.all(apts.docs.map((d) => d.ref.delete()));
  });

  it('creates a private family_submitted reference when caller has a confirmed appointment', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    const result = await callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'Lea was wonderful with our kids.',
      refName: 'Marie Dupont',
    });

    expect(result.referenceId).toBeTruthy();
    const ref = await getDb().collection('references').doc(result.referenceId).get();
    const data = ref.data()!;
    expect(data.type).toBe('family_submitted');
    expect(data.status).toBe('private');
    expect(data.submittedByUserId).toBe(seed.parent1.uid);
    expect(data.submittedByFamilyId).toBe(seed.parent1.familyId);
    expect(data.babysitterUserId).toBe(seed.babysitter1.uid);
    expect(data.appointmentId).toBe(aptId);
    expect(data.referenceText).toBe('Lea was wonderful with our kids.');
    // Server-derived, not client-supplied:
    expect(typeof data.isEjmFamily).toBe('boolean');
    expect(data.createdAt).toBeTruthy();
  });

  it('rejects when caller has no confirmed appointment with the babysitter', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'pending', // not confirmed
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'Trying to endorse without a real appointment.',
      refName: 'Marie Dupont',
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });

    const snap = await getDb().collection('references').get();
    expect(snap.size).toBe(0);
  });

  it('rejects when appointmentId belongs to a different family', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent2.familyId, // different family
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent2.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'Trying to ride on another family appointment.',
      refName: 'Marie Dupont',
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('rejects when babysitterUserId in the request does not match the appointment', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter2.uid, // different babysitter
      appointmentId: aptId,
      referenceText: 'Trying to endorse a different babysitter.',
      refName: 'Marie Dupont',
    })).rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('rejects self-endorsement (caller is the babysitter)', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    // Use babysitter1's token instead of a parent's
    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'Self-promotion attempt.',
      refName: 'Lea Bernard',
    })).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  });

  it('rejects when referenceText is too short', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await expect(callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'too short',
      refName: 'Marie Dupont',
    })).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  });

  it('rejects duplicate endorsement for same (submitter, babysitter, appointment) triple', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    const token = await getIdToken(seed.parent1.uid);
    await callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'First endorsement, all valid.',
      refName: 'Marie Dupont',
    });

    await expect(callCallable('submitFamilyEndorsement', token, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'Second endorsement, should fail.',
      refName: 'Marie Dupont',
    })).rejects.toMatchObject({ code: 'functions/already-exists' });
  });

  it('rejects unauthenticated callers', async () => {
    const aptId = await seedAppointment({
      familyId: seed.parent1.familyId,
      babysitterUserId: seed.babysitter1.uid,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });

    await expect(callCallable('submitFamilyEndorsement', null, {
      babysitterUserId: seed.babysitter1.uid,
      appointmentId: aptId,
      referenceText: 'Anonymous attempt at endorsement.',
      refName: 'Anon',
    })).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  });
});
```

If `callCallable` does not exist in `tests/setup/emulator.ts`, search for the existing pattern other integration tests use to invoke callables (e.g. `tests/integration/admin/delete-user.test.ts`) and adopt it verbatim — do not invent a new helper.

- [ ] **Step 3: Run the failing test to confirm fixture wiring**

```bash
pnpm install --filter "@ejm/tests..." 2>&1 | tail -3
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,functions \
  'pnpm --filter @ejm/tests exec vitest run integration/references/submit-family-endorsement.test.ts'
```
Expected: every test fails with `functions/not-found` ("callable does not exist") or equivalent — never with a fixture/setup error. Setup errors mean the seed/auth helpers don't match an existing test; fix that before continuing.

- [ ] **Step 4: Implement the callable**

Create `apps/functions/src/references/submitFamilyEndorsement.ts`:

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

interface SubmitFamilyEndorsementData {
  babysitterUserId: string;
  appointmentId: string;
  referenceText: string;
  refName: string;
  refPhone?: string | null;
  refWhatsapp?: string | null;
  refEmail?: string | null;
  numberOfKids?: number | null;
  kidAges?: number[] | null;
}

export const submitFamilyEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = request.data as SubmitFamilyEndorsementData;

    if (!data?.babysitterUserId || !data?.appointmentId || !data?.referenceText || !data?.refName) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }
    if (data.referenceText.trim().length < 10) {
      throw new HttpsError('invalid-argument', 'Reference text too short (min 10 characters)');
    }
    if (data.babysitterUserId === uid) {
      throw new HttpsError('invalid-argument', 'Cannot endorse yourself');
    }

    const callerSnap = await db.collection('users').doc(uid).get();
    const caller = callerSnap.data();
    if (!callerSnap.exists || caller?.role !== 'parent' || !caller?.familyId) {
      throw new HttpsError('permission-denied', 'Only parents in a family can submit endorsements');
    }
    const familyId = caller.familyId as string;

    const aptSnap = await db.collection('appointments').doc(data.appointmentId).get();
    if (!aptSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }
    const apt = aptSnap.data()!;
    if (
      apt.familyId !== familyId ||
      apt.babysitterUserId !== data.babysitterUserId ||
      apt.status !== 'confirmed'
    ) {
      throw new HttpsError('permission-denied', 'Endorsement requires a confirmed appointment with this babysitter');
    }

    const dupQuery = await db.collection('references')
      .where('submittedByUserId', '==', uid)
      .where('babysitterUserId', '==', data.babysitterUserId)
      .where('appointmentId', '==', data.appointmentId)
      .limit(1)
      .get();
    if (!dupQuery.empty) {
      throw new HttpsError('already-exists', 'You have already submitted an endorsement for this appointment');
    }

    const familySnap = await db.collection('families').doc(familyId).get();
    const isEjmFamily = !!familySnap.data()?.verification?.isFullyVerified;

    const refDoc = db.collection('references').doc();
    const payload: Record<string, unknown> = {
      referenceId: refDoc.id,
      type: 'family_submitted',
      status: 'private',
      babysitterUserId: data.babysitterUserId,
      submittedByUserId: uid,
      submittedByFamilyId: familyId,
      submittedByName: data.refName.trim(),
      appointmentId: data.appointmentId,
      referenceText: data.referenceText.trim(),
      refName: data.refName.trim(),
      isEjmFamily,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.refPhone) payload.refPhone = data.refPhone;
    if (data.refWhatsapp) payload.refWhatsapp = data.refWhatsapp;
    if (data.refEmail) payload.refEmail = data.refEmail;
    if (typeof data.numberOfKids === 'number') payload.numberOfKids = data.numberOfKids;
    if (Array.isArray(data.kidAges) && data.kidAges.length > 0) payload.kidAges = data.kidAges;

    await refDoc.set(payload);
    return { referenceId: refDoc.id };
  }
);
```

- [ ] **Step 5: Register the callable in `apps/functions/src/index.ts`**

Add a new line in the references block (currently has only `notifyOnNewReference`):

```typescript
export { submitFamilyEndorsement } from './references/submitFamilyEndorsement.js';
```

Place it immediately above the trigger export so callables stay grouped.

- [ ] **Step 6: Run typecheck + build + the failing test**

```bash
pnpm -r --filter './packages/**' build
pnpm --filter functions typecheck
pnpm --filter functions build
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,functions \
  'pnpm --filter @ejm/tests exec vitest run integration/references/submit-family-endorsement.test.ts'
```
Expected: typecheck clean, build clean, all 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/functions/src/references/submitFamilyEndorsement.ts \
        apps/functions/src/index.ts \
        tests/integration/references/submit-family-endorsement.test.ts
git commit -m "feat(references): add submitFamilyEndorsement callable (BL-5)

Closes the BL-5 finding from agent-9-security-baseline §7. The new callable
performs the appointments-lookup relationship check that the Firestore rule
cannot express, and forces server-side derivation of submittedByUserId,
submittedByFamilyId, isEjmFamily, status, type, and createdAt. Duplicate
endorsements for the same (submitter, babysitter, appointment) triple are
rejected with already-exists."
```

---

## Task 2: `acceptFamilyEndorsement` callable

**Files:**
- Create: `apps/functions/src/references/acceptFamilyEndorsement.ts`
- Create: `tests/integration/references/accept-family-endorsement.test.ts`
- Modify: `apps/functions/src/index.ts` (add export)

**Purpose:** The babysitter accepts a `family_submitted` endorsement about themselves, transitioning it from `private` → `approved`. This transition is denied by the current update rule (rule restricts client transitions to `private`/`removed`). Closes the legitimate half of the BL-6 gap.

**Inputs:**
```typescript
interface AcceptFamilyEndorsementData { referenceId: string; }
```

**Validation:**
1. Auth present.
2. `referenceId` present.
3. Reference doc exists; type is `family_submitted`; current status is `private`.
4. `data.babysitterUserId === uid` (caller is the target babysitter).
5. Caller has `users/{uid}.role === 'babysitter'`.

**Server writes:**
- `status = 'approved'`
- `approvedAt = FieldValue.serverTimestamp()`
- `updatedAt = FieldValue.serverTimestamp()`
- Plus a `writeUserActivity(uid, 'reference.accept', { referenceId, submittedByUserId })` entry (using the existing helper).

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/references/accept-family-endorsement.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb, getIdToken, callCallable } from '../../setup/emulator.js';
import { seedTestData, seedReference, type SeedData } from '../../setup/seed.js';

describe('acceptFamilyEndorsement callable', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const snap = await db.collection('references').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    const auditSnap = await db.collection('auditLogs').get();
    await Promise.all(auditSnap.docs.map((d) => d.ref.delete()));
  });

  it('transitions a private family_submitted ref to approved when caller is the babysitter', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      submittedByUserId: seed.parent1.uid,
      submittedByName: 'Marie Dupont',
      status: 'private',
    });

    const token = await getIdToken(seed.babysitter1.uid);
    await callCallable('acceptFamilyEndorsement', token, { referenceId: refId });

    const ref = await getDb().collection('references').doc(refId).get();
    expect(ref.data()!.status).toBe('approved');
    expect(ref.data()!.approvedAt).toBeTruthy();

    const audit = await getDb().collection('auditLogs')
      .where('adminUserId', '==', seed.babysitter1.uid)
      .where('action', '==', 'reference.accept')
      .get();
    expect(audit.size).toBe(1);
  });

  it('rejects when caller is not the babysitter of the reference', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      submittedByUserId: seed.parent1.uid,
      submittedByName: 'Marie Dupont',
      status: 'private',
    });

    const token = await getIdToken(seed.babysitter2.uid);
    await expect(callCallable('acceptFamilyEndorsement', token, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('rejects when reference is not family_submitted', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
    });

    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callCallable('acceptFamilyEndorsement', token, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('rejects when reference is not in private status', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      submittedByUserId: seed.parent1.uid,
      submittedByName: 'Marie Dupont',
      status: 'approved',
    });

    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callCallable('acceptFamilyEndorsement', token, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('rejects unauthenticated callers', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      submittedByUserId: seed.parent1.uid,
      submittedByName: 'Marie Dupont',
      status: 'private',
    });

    await expect(callCallable('acceptFamilyEndorsement', null, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/unauthenticated' });
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,functions \
  'pnpm --filter @ejm/tests exec vitest run integration/references/accept-family-endorsement.test.ts'
```
Expected: every test fails with `functions/not-found`.

- [ ] **Step 3: Implement the callable**

Create `apps/functions/src/references/acceptFamilyEndorsement.ts`:

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface AcceptFamilyEndorsementData { referenceId: string; }

export const acceptFamilyEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = request.data as AcceptFamilyEndorsementData;
    if (!data?.referenceId) {
      throw new HttpsError('invalid-argument', 'Missing referenceId');
    }

    const refDoc = db.collection('references').doc(data.referenceId);
    const snap = await refDoc.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Reference not found');
    }
    const ref = snap.data()!;

    if (ref.babysitterUserId !== uid) {
      throw new HttpsError('permission-denied', 'Only the babysitter can accept this endorsement');
    }
    if (ref.type !== 'family_submitted') {
      throw new HttpsError('failed-precondition', 'Only family-submitted endorsements can be accepted');
    }
    if (ref.status !== 'private') {
      throw new HttpsError('failed-precondition', 'Endorsement is no longer pending acceptance');
    }

    await refDoc.update({
      status: 'approved',
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeUserActivity(uid, 'reference.accept', {
      referenceId: data.referenceId,
      submittedByUserId: ref.submittedByUserId ?? null,
    });

    return { ok: true };
  }
);
```

- [ ] **Step 4: Register the callable**

Add to `apps/functions/src/index.ts` immediately after `submitFamilyEndorsement`:

```typescript
export { acceptFamilyEndorsement } from './references/acceptFamilyEndorsement.js';
```

- [ ] **Step 5: Run the tests + typecheck + build**

```bash
pnpm --filter functions typecheck
pnpm --filter functions build
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,functions \
  'pnpm --filter @ejm/tests exec vitest run integration/references/accept-family-endorsement.test.ts'
```
Expected: typecheck clean, build clean, all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/references/acceptFamilyEndorsement.ts \
        apps/functions/src/index.ts \
        tests/integration/references/accept-family-endorsement.test.ts
git commit -m "feat(references): add acceptFamilyEndorsement callable (BL-6 part 1)

Adds the legitimate private->approved transition for babysitter acceptance
of family-submitted endorsements. The Firestore rule restricts client
transitions to private/removed; this callable performs the same write
server-side with caller=babysitter-of-record validation and an audit log
entry."
```

---

## Task 3: `publishManualReference` callable

**Files:**
- Create: `apps/functions/src/references/publishManualReference.ts`
- Create: `tests/integration/references/publish-manual-reference.test.ts`
- Modify: `apps/functions/src/index.ts` (add export)

**Purpose:** Admin promotes a manual reference (the babysitter's own offline reference) to `status='published'`. Closes the second half of BL-6. v1 is admin-only; peer-approval gating is intentionally deferred and documented in the commit message.

**Inputs:**
```typescript
interface PublishManualReferenceData { referenceId: string; }
```

**Validation:**
1. Auth present.
2. `verifyAdmin(uid)` succeeds.
3. Reference doc exists; type is `manual`; current status is `private`.

**Server writes:**
- `status = 'published'`
- `approvedAt = FieldValue.serverTimestamp()`
- `updatedAt = FieldValue.serverTimestamp()`
- `writeAuditLog({ adminUserId: uid, action: 'reference.publish', details: { referenceId, babysitterUserId: ref.babysitterUserId } })`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/references/publish-manual-reference.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb, getIdToken, callCallable } from '../../setup/emulator.js';
import { seedTestData, seedReference, type SeedData } from '../../setup/seed.js';

describe('publishManualReference callable', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const snap = await db.collection('references').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    const auditSnap = await db.collection('auditLogs').get();
    await Promise.all(auditSnap.docs.map((d) => d.ref.delete()));
  });

  it('admin can publish a private manual reference', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
      fullName: 'Famille Bonjour',
    });

    const token = await getIdToken(seed.admin.uid);
    await callCallable('publishManualReference', token, { referenceId: refId });

    const ref = await getDb().collection('references').doc(refId).get();
    expect(ref.data()!.status).toBe('published');
    expect(ref.data()!.approvedAt).toBeTruthy();

    const audit = await getDb().collection('auditLogs')
      .where('adminUserId', '==', seed.admin.uid)
      .where('action', '==', 'reference.publish')
      .get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().details.referenceId).toBe(refId);
  });

  it('rejects non-admin caller (even the babysitter who owns the reference)', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
    });

    const token = await getIdToken(seed.babysitter1.uid);
    await expect(callCallable('publishManualReference', token, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/permission-denied' });
  });

  it('rejects when reference is not manual', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'family_submitted',
      submittedByUserId: seed.parent1.uid,
      submittedByName: 'Marie Dupont',
      status: 'private',
    });

    const token = await getIdToken(seed.admin.uid);
    await expect(callCallable('publishManualReference', token, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('rejects when manual reference is not in private status', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'published',
    });

    const token = await getIdToken(seed.admin.uid);
    await expect(callCallable('publishManualReference', token, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/failed-precondition' });
  });

  it('rejects unauthenticated callers', async () => {
    const refId = await seedReference({
      babysitterUserId: seed.babysitter1.uid,
      type: 'manual',
      status: 'private',
    });

    await expect(callCallable('publishManualReference', null, { referenceId: refId }))
      .rejects.toMatchObject({ code: 'functions/unauthenticated' });
  });
});
```

If `seed.admin` does not exist on `SeedData`, extend `tests/setup/seed.ts` to seed an admin user (mirror the existing parent/babysitter seed entries; set `role: 'admin'`). Update the type and the `seedTestData` body. Commit that change as part of this task.

- [ ] **Step 2: Run the failing test**

```bash
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,functions \
  'pnpm --filter @ejm/tests exec vitest run integration/references/publish-manual-reference.test.ts'
```
Expected: every test fails with `functions/not-found`.

- [ ] **Step 3: Implement the callable**

Create `apps/functions/src/references/publishManualReference.ts`:

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';

interface PublishManualReferenceData { referenceId: string; }

export const publishManualReference = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    await verifyAdmin(uid);

    const data = request.data as PublishManualReferenceData;
    if (!data?.referenceId) {
      throw new HttpsError('invalid-argument', 'Missing referenceId');
    }

    const refDoc = db.collection('references').doc(data.referenceId);
    const snap = await refDoc.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Reference not found');
    }
    const ref = snap.data()!;
    if (ref.type !== 'manual') {
      throw new HttpsError('failed-precondition', 'Only manual references can be published via this path');
    }
    if (ref.status !== 'private') {
      throw new HttpsError('failed-precondition', 'Reference is not in private status');
    }

    await refDoc.update({
      status: 'published',
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      adminUserId: uid,
      action: 'reference.publish',
      details: {
        referenceId: data.referenceId,
        babysitterUserId: ref.babysitterUserId,
      },
    });

    return { ok: true };
  }
);
```

- [ ] **Step 4: Register the callable**

Add to `apps/functions/src/index.ts` immediately after `acceptFamilyEndorsement`:

```typescript
export { publishManualReference } from './references/publishManualReference.js';
```

- [ ] **Step 5: Run the tests + typecheck + build**

```bash
pnpm --filter functions typecheck
pnpm --filter functions build
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,functions \
  'pnpm --filter @ejm/tests exec vitest run integration/references/'
```
Expected: typecheck clean, build clean, all three reference integration test files pass.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/references/publishManualReference.ts \
        apps/functions/src/index.ts \
        tests/integration/references/publish-manual-reference.test.ts \
        tests/setup/seed.ts
git commit -m "feat(references): add publishManualReference admin callable (BL-6 part 2)

Closes the remaining BL-6 gap: legitimate promotion of a manual reference
to status='published' was unreachable from any client after the Phase -1
rule tightening killed the fraud vector. The new callable is admin-gated
via verifyAdmin and writes an audit log entry. Peer-approval gating
(the second BL-6 option) is deferred to a follow-up — admin gating
is sufficient to ship the unblock."
```

---

## Task 4: Tighten the `references` create rule

**Files:**
- Modify: `firestore.rules` — `match /references/{referenceId}` create rule.
- Modify: `tests/rules/firestore-rules.test.ts` — add a `describe('references collection', …)` block (if not already present) with positive/negative create tests.

**Change:** remove the `type=='family_submitted'` branch from the create rule. Keep the `type=='manual'` branch unchanged.

- [ ] **Step 1: Write the failing rules tests**

Append a new `describe` block to `tests/rules/firestore-rules.test.ts`. If a `describe('references collection', …)` already exists, add the new `it` blocks inside it.

```typescript
describe('references collection (post-BL-5 tightening)', () => {
  it('still allows a babysitter to create a manual reference about themselves', async () => {
    const authed = testEnv.authenticatedContext('babysitter1');
    await assertSucceeds(
      setDoc(doc(authed.firestore(), 'references', 'man1'), {
        babysitterUserId: 'babysitter1',
        type: 'manual',
        status: 'private',
        refName: 'Famille Bonjour',
        createdAt: new Date(),
      })
    );
  });

  it('denies a parent from creating a family_submitted reference via client SDK', async () => {
    const authed = testEnv.authenticatedContext('parent1');
    await assertFails(
      setDoc(doc(authed.firestore(), 'references', 'fs1'), {
        babysitterUserId: 'babysitter1',
        submittedByUserId: 'parent1',
        type: 'family_submitted',
        status: 'private',
        referenceText: 'I would have written this without the callable.',
        createdAt: new Date(),
      })
    );
  });

  it('still denies babysitter self-create with family_submitted type', async () => {
    const authed = testEnv.authenticatedContext('babysitter1');
    await assertFails(
      setDoc(doc(authed.firestore(), 'references', 'fs-self'), {
        babysitterUserId: 'babysitter1',
        submittedByUserId: 'babysitter1',
        type: 'family_submitted',
        status: 'private',
        referenceText: 'Trying self-puffery via the removed branch.',
        createdAt: new Date(),
      })
    );
  });

  it('still denies status transitions to approved/published from any client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'r1'), {
        babysitterUserId: 'babysitter1',
        type: 'manual',
        status: 'private',
        createdAt: new Date(),
      });
    });

    const authed = testEnv.authenticatedContext('babysitter1');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'references', 'r1'), { status: 'published' })
    );
    await assertFails(
      updateDoc(doc(authed.firestore(), 'references', 'r1'), { status: 'approved' })
    );
  });
});
```

- [ ] **Step 2: Run the rules harness — confirm the second/third tests fail (the rule still allows family_submitted client-create)**

```bash
pnpm install --filter "@ejm/tests..." 2>&1 | tail -3
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,storage \
  'pnpm --filter @ejm/tests exec vitest run rules/firestore-rules.test.ts'
```
Expected: tests 1 + 4 in the new block pass; tests 2 + 3 fail because the current rule still has the `family_submitted` branch.

- [ ] **Step 3: Tighten the rule**

In `firestore.rules`, replace the `references` create rule (the multi-branch block that begins `allow create: if isAuth() && request.resource.data.status == 'private' && (` and ends with the matching closing paren before `;`) with this single-branch rule:

```
      // Create: babysitters may record their own offline manual references.
      // Parent endorsements (type='family_submitted') and admin/peer
      // approvals (type='manual' moving to status='approved'/'published')
      // are NOT writable from the client SDK — they go through the
      // submitFamilyEndorsement / acceptFamilyEndorsement /
      // publishManualReference callables, which validate the
      // submitter↔babysitter relationship and admin role server-side.
      // See agent-9-security-baseline.md §7 [BL-5] and [BL-6].
      allow create: if isAuth()
        && request.resource.data.status == 'private'
        && request.resource.data.babysitterUserId == request.auth.uid
        && request.resource.data.type == 'manual'
        && (!('submittedByUserId' in request.resource.data)
            || request.resource.data.submittedByUserId == null);
```

Leave the existing comment block and the update/delete rules unchanged.

- [ ] **Step 4: Re-run the rules harness — confirm all baseline + new tests pass**

```bash
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,storage \
  'pnpm --filter @ejm/tests exec vitest run rules/'
```
Expected: 31 baseline rules tests + the 4 new ones, all green. Total: 35.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules/firestore-rules.test.ts
git commit -m "fix(rules): remove client-side family_submitted reference create (BL-5)

The Firestore rule could not express the submitter<->babysitter
relationship that a legitimate family_submitted reference requires
(no appointments lookup in rule language). With submitFamilyEndorsement
now in place, the rule is tightened to deny that branch entirely. Manual
self-create by babysitters is unchanged. Adds 4 rules tests covering
the tightening (1 positive, 3 negative). Closes BL-5 at the rule layer."
```

---

## Task 5: Client refactor — call callables; drop the orphaned self-publish path

**Files:**
- Create: `apps/web/src/hooks/useReferenceActions.ts`
- Modify: `apps/web/src/hooks/useEndorsements.ts`
- Modify: `apps/web/src/hooks/__tests__/useEndorsements.behavior.test.ts`
- Modify: `apps/web/src/components/endorsements/EndorsementDialog.tsx`
- Modify: `apps/web/src/pages/babysitter/EndorsementsPage.tsx`
- Modify: `apps/web/src/i18n/locales/en.json` + `fr.json`

**Purpose:** The client now invokes the three new callables instead of doing the writes that the rules deny. `publishReference` and `unpublishReference` (the orphaned self-publish path; UI already hidden in Phase -1) are removed from `useEndorsements` entirely — the rule denies them and no callable replaces them on the babysitter UX. An "Accept" button is wired on each `private` `family_submitted` reference in the babysitter's endorsements list.

- [ ] **Step 1: Create the callable wrapper hook**

Create `apps/web/src/hooks/useReferenceActions.ts`:

```typescript
import { useCallback } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/config/firebase';

const functions = getFunctions(app, 'europe-west1');

const submitFamilyEndorsementFn = httpsCallable<
  {
    babysitterUserId: string;
    appointmentId: string;
    referenceText: string;
    refName: string;
    refPhone?: string | null;
    refWhatsapp?: string | null;
    refEmail?: string | null;
    numberOfKids?: number | null;
    kidAges?: number[] | null;
  },
  { referenceId: string }
>(functions, 'submitFamilyEndorsement');

const acceptFamilyEndorsementFn = httpsCallable<
  { referenceId: string },
  { ok: boolean }
>(functions, 'acceptFamilyEndorsement');

const publishManualReferenceFn = httpsCallable<
  { referenceId: string },
  { ok: boolean }
>(functions, 'publishManualReference');

export function useReferenceActions() {
  const submitFamilyEndorsement = useCallback(
    async (input: Parameters<typeof submitFamilyEndorsementFn>[0]) => {
      const result = await submitFamilyEndorsementFn(input);
      return result.data;
    },
    []
  );

  const acceptFamilyEndorsement = useCallback(async (referenceId: string) => {
    await acceptFamilyEndorsementFn({ referenceId });
  }, []);

  const publishManualReference = useCallback(async (referenceId: string) => {
    await publishManualReferenceFn({ referenceId });
  }, []);

  return { submitFamilyEndorsement, acceptFamilyEndorsement, publishManualReference };
}
```

If `app` is not exported from `@/config/firebase`, search for the existing pattern used by other hooks that call `httpsCallable` (e.g. `apps/web/src/hooks/useSearch.ts` if it exists, or any other place `getFunctions(` is called) and follow it verbatim.

- [ ] **Step 2: Add new i18n strings**

Modify `apps/web/src/i18n/locales/en.json` to add (within the existing `references` block, in alphabetical order):

```json
"acceptButton": "Accept this endorsement",
"endorsementAccepted": "Endorsement accepted",
```

Modify `apps/web/src/i18n/locales/fr.json` to add the French equivalents within the matching `references` block:

```json
"acceptButton": "Accepter cette recommandation",
"endorsementAccepted": "Recommandation acceptée",
```

- [ ] **Step 3: Refactor `useEndorsements.ts` — remove publish/unpublish**

In `apps/web/src/hooks/useEndorsements.ts`:

(a) Remove the `publishReference` and `unpublishReference` `useCallback` blocks (they targeted the rule-denied transitions).
(b) Remove both names from the returned object at the bottom.
(c) Leave `addManualReference`, `updateManualReference`, `removeReference`, and the subscription unchanged.

The returned object should now contain exactly: `manualRefs`, `familySubmittedRefs`, `loading`, `addManualReference`, `updateManualReference`, `removeReference`.

- [ ] **Step 4: Update the existing `useEndorsements` behavior test**

In `apps/web/src/hooks/__tests__/useEndorsements.behavior.test.ts`, remove any test cases that invoke `publishReference` or `unpublishReference` (they will fail to type-check after Step 3). Confirm via:

```bash
grep -n "publishReference\|unpublishReference" apps/web/src/hooks/__tests__/useEndorsements.behavior.test.ts
```
Expected: zero matches after the edit. Then:

```bash
pnpm --filter web test useEndorsements.behavior 2>&1 | tail -10
```
Expected: all remaining test cases pass.

- [ ] **Step 5: Refactor `EndorsementDialog.tsx` — create-path calls the callable**

In `apps/web/src/components/endorsements/EndorsementDialog.tsx`:

(a) At the top of the file, add:

```typescript
import { useReferenceActions } from '@/hooks/useReferenceActions';
```

(b) Inside the component body, add a hook call:

```typescript
const { submitFamilyEndorsement } = useReferenceActions();
```

(c) In `handleSubmit`, replace the entire `else` branch (the `addDoc(collection(db, 'references'), {...})` block, followed by `updateDoc(ref, { referenceId: ref.id })`) with:

```typescript
await submitFamilyEndorsement({
  babysitterUserId,
  appointmentId,
  referenceText: text.trim(),
  refName: refName.trim(),
  refPhone: refPhone || null,
  refWhatsapp: whatsappValue,
  refEmail: refEmail || null,
  numberOfKids: numberOfKids || null,
  kidAges: parsedAges.length > 0 ? parsedAges : null,
});
```

(d) Remove the unused `addDoc` and `collection` imports if no other code paths use them. Run:

```bash
grep -n "addDoc\|collection(db," apps/web/src/components/endorsements/EndorsementDialog.tsx
```
If only the `import` line matches, remove the unused names from that import.

The edit-path (`isEdit && existingReference`) `updateDoc` block is unchanged — the rule still permits it.

- [ ] **Step 6: Wire the Accept button on `EndorsementsPage.tsx`**

In `apps/web/src/pages/babysitter/EndorsementsPage.tsx`:

(a) Add the hook import:

```typescript
import { useReferenceActions } from '@/hooks/useReferenceActions';
```

(b) Inside the component:

```typescript
const { acceptFamilyEndorsement } = useReferenceActions();
const [acceptingId, setAcceptingId] = useState<string | null>(null);

const handleAccept = useCallback(async (referenceId: string) => {
  setAcceptingId(referenceId);
  try {
    await acceptFamilyEndorsement(referenceId);
  } finally {
    setAcceptingId(null);
  }
}, [acceptFamilyEndorsement]);
```

(c) In the JSX block that renders each `familySubmittedRefs` item, find the existing rendered card and add — only when `ref.status === 'private'` — a button below the existing actions:

```tsx
{ref.status === 'private' && (
  <Button
    variant="primary"
    onClick={() => handleAccept(ref.referenceId)}
    disabled={acceptingId === ref.referenceId}
  >
    {acceptingId === ref.referenceId ? t('common.loading') : t('references.acceptButton')}
  </Button>
)}
```

If a `Button` variant other than `'primary'` is the convention on this page (check the existing buttons in the file), use that variant instead.

(d) Remove any remaining JSX that references the old `publishReference` / `unpublishReference` hook returns. The hook returns no longer expose them, so the file will not type-check until those references are gone.

- [ ] **Step 7: Run typecheck + lint + relevant test files**

```bash
pnpm -r --filter './packages/**' build
pnpm typecheck 2>&1 | tail -10
pnpm -r lint 2>&1 | tail -10
pnpm --filter web test useEndorsements 2>&1 | tail -10
```
Expected: typecheck clean across all packages; lint 0 errors (pre-existing warnings unchanged); hook tests pass.

- [ ] **Step 8: Visual smoke against emulators (optional but recommended)**

Per the standing workflow:

```bash
# Terminal 1
pnpm emulators
# Terminal 2 (after emulators are ready)
node apps/functions/seed-test-data.cjs
# Terminal 3
pnpm --filter web dev
```

Manual flow:
1. Sign in as `marie.dupont@test.com` / `test1234`.
2. Open an appointment that's in `confirmed` status with a babysitter.
3. Open the endorsement dialog, submit a `referenceText` (>=10 chars) plus the required name. Expect the success state in the dialog.
4. Sign out, sign in as `lea.bernard@ejm.org` / `test1234` (the babysitter on that appointment).
5. Open the babysitter's Endorsements page. The new endorsement should appear in the family-submitted list with the "Accept this endorsement" button.
6. Click Accept. Button shows loading state, then the endorsement's status moves to `approved` (verify via the Firestore emulator UI or by re-rendering).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/hooks/useReferenceActions.ts \
        apps/web/src/hooks/useEndorsements.ts \
        apps/web/src/hooks/__tests__/useEndorsements.behavior.test.ts \
        apps/web/src/components/endorsements/EndorsementDialog.tsx \
        apps/web/src/pages/babysitter/EndorsementsPage.tsx \
        apps/web/src/i18n/locales/en.json \
        apps/web/src/i18n/locales/fr.json
git commit -m "refactor(web): route family endorsements through callables (BL-5/BL-6)

Adds useReferenceActions hook wrapping submitFamilyEndorsement,
acceptFamilyEndorsement, and publishManualReference. EndorsementDialog
now calls the submit callable instead of writing references directly
(the rule no longer accepts family_submitted client creates). The
babysitter Endorsements page gains an Accept button for private
family-submitted endorsements. publishReference/unpublishReference
are removed from useEndorsements — their UI affordance was hidden in
Phase -1 and the rule denies the transition; the legitimate publish
path is now publishManualReference, an admin-only callable."
```

---

## Final verification (after all 5 tasks)

- [ ] **Run the full check suite**

```bash
pnpm -r --filter './packages/**' build
pnpm typecheck
pnpm -r lint
pnpm --filter functions build
pnpm --filter web build

# Rules + integration tests against emulators
npx -y firebase-tools@latest emulators:exec --project demo-test \
  --only firestore,auth,storage,functions \
  'pnpm --filter @ejm/tests exec vitest run'
```

Expected outcomes:
- typecheck: clean across all packages
- lint: 0 errors (the 7 pre-existing warnings on main are unchanged)
- web build: clean
- functions build: clean
- rules tests: 35 pass (31 baseline + 4 new)
- integration tests: prior count + 18 new (8 submit + 5 accept + 5 publish)

- [ ] **Push branch and open PR**

```bash
git push -u origin feature/sync-study-references-publish-callables
gh pr create --title "Close BL-5/BL-6: references publish-path callables" --body "..."
```

PR body should reference `agent-9-security-baseline.md` §7 entries BL-5 and BL-6 by name, list the three new callables and the rule tightening, and call out the deferred peer-approval gating for `publishManualReference` as a follow-up.

---

## Self-review notes (verify after writing the plan)

- Spec coverage: BL-5 → Tasks 1 + 4. BL-6 → Tasks 2 + 3. Client wiring → Task 5. Rules tightening → Task 4. Audit log for publish → Task 3. Audit log for accept → Task 2. ✓
- No placeholders. Every code block is concrete; the only "if X does not exist, follow existing pattern" notes target test/firebase init helpers that this plan should not invent. ✓
- Type consistency: `referenceId`, `babysitterUserId`, `submittedByUserId`, `submittedByFamilyId`, `submittedByName`, `appointmentId`, `referenceText` used consistently. Callable names match between server task, test task, and client hook task. ✓
- Deferred (out of scope): peer-approval gating on `publishManualReference`; admin UI surface for the publish callable (admins can call it via emulator/CLI for now); migration of existing pre-tightening `family_submitted` references created via the rule (they remain valid documents and the `acceptFamilyEndorsement` callable accepts them).
