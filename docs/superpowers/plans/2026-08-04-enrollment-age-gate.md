# Enrollment Age Gate (Parental Governance PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-enforced under-15 self-enrollment block using dual signals (entered dateOfBirth + graduation year from the EJM email), with distinct rejection messages, an admin-approvable exemption for DOB/grad-year mismatches, a sit search backstop, and a prod count script.

**Architecture:** A pure `agePolicy` helper in shared-core derives an expected age from the email's 2-digit graduation year (September school-year boundary, matching `getValidGraduationYears`) and classifies `{ok | under_15 | age_mismatch}` with a one-class (±1 year) tolerance. Study enforces the full dual-signal check inside `enrollTutor` (it receives DOB server-side). Sit's `enrollBabysitter` receives NO DOB (profile completed client-side afterwards), and every currently-valid EJM email implies age ≥14, so a grad-year-only creation gate is vacuous — sit therefore enforces at the **consumption point**: `searchBabysitters` excludes under-15/mismatched providers (exemption doc consulted only on failure), plus client-side DOB validation with the friendly message at profile completion. `enrollmentExemptions/{email}` (admin-managed) waives ONLY the consistency check, never the under-15 floor. See `2026-08-04-parental-governance-design.md` for the full approved design.

**Error contract:** callables throw `HttpsError('failed-precondition', <message>, { code })` with `code: 'age/under-15' | 'age/mismatch'`. Clients branch on `error.details?.code` (verify how existing study-web code reads HttpsError details and follow that idiom).

- under-15 message: "You need to be at least 15 to enroll on your own. Your parents can create an account and enroll you from theirs."
- mismatch message: "Your date of birth doesn't match your school year. Please contact the EJM administrator."

---

## Task 1: `agePolicy` helper in shared-core (TDD)

**Files:**
- Create: `packages/shared-core/src/utils/agePolicy.ts`
- Test: `packages/shared-core/src/utils/__tests__/agePolicy.test.ts` (follow the package's existing test layout — check where ejm-email tests live and mirror it)
- Modify: shared-core package index to export the new module (mirror how `ejm-email.ts` is exported)

- [ ] **Step 1.1: failing unit tests.** Cases (use fixed `now` dates, never the real clock):

```ts
import { describe, it, expect } from 'vitest';
import { schoolYearEnd, expectedAgeForGradYear, checkEnrollmentAge } from '../agePolicy.js';

describe('schoolYearEnd', () => {
  it('is the current year before September', () => {
    expect(schoolYearEnd(new Date('2026-08-04T12:00:00Z'))).toBe(2026);
  });
  it('rolls to next year from September (Paris)', () => {
    expect(schoolYearEnd(new Date('2026-09-01T12:00:00Z'))).toBe(2027);
  });
  it('uses Paris wall clock at the boundary (Aug 31 23:30Z is Sept 1 in Paris)', () => {
    expect(schoolYearEnd(new Date('2026-08-31T23:30:00Z'))).toBe(2027);
  });
});

describe('expectedAgeForGradYear', () => {
  // School year ending 2026: a terminale student (grad 26) is ~18.
  it('terminale ≈ 18', () => {
    expect(expectedAgeForGradYear(26, new Date('2026-03-01T12:00:00Z'))).toBe(18);
  });
  it('seconde ≈ 15 (grad 3 years out)', () => {
    expect(expectedAgeForGradYear(29, new Date('2026-03-01T12:00:00Z'))).toBe(15);
  });
  it('after the September rollover the same grad year implies one year older cohort', () => {
    expect(expectedAgeForGradYear(29, new Date('2026-10-01T12:00:00Z'))).toBe(16);
  });
});

describe('checkEnrollmentAge (dual-signal)', () => {
  const now = new Date('2026-03-01T12:00:00Z'); // school year ends 2026
  it('ok: consistent 16-year-old (grad 28 → expected 16)', () => {
    expect(checkEnrollmentAge({ dateOfBirth: new Date('2010-01-15'), graduationYear: 28, now }))
      .toBe('ok');
  });
  it('ok at tolerance edge: |age − expected| == 1', () => {
    expect(checkEnrollmentAge({ dateOfBirth: new Date('2009-01-15'), graduationYear: 28, now }))
      .toBe('ok'); // age 17, expected 16
  });
  it('under_15 by DOB even when grad year is consistent', () => {
    // grad 29 → expected 15; DOB age 14 → floor fires first
    expect(checkEnrollmentAge({ dateOfBirth: new Date('2011-06-15'), graduationYear: 29, now }))
      .toBe('under_15');
  });
  it('under_15 exactly the day before the 15th birthday', () => {
    expect(checkEnrollmentAge({ dateOfBirth: new Date('2011-03-02'), graduationYear: 29, now }))
      .toBe('under_15');
  });
  it('ok exactly on the 15th birthday', () => {
    expect(checkEnrollmentAge({ dateOfBirth: new Date('2011-03-01'), graduationYear: 29, now }))
      .toBe('ok'); // age 15, expected 15
  });
  it('age_mismatch beyond one class: claims 18 with a grad year implying 15', () => {
    expect(checkEnrollmentAge({ dateOfBirth: new Date('2008-01-15'), graduationYear: 29, now }))
      .toBe('age_mismatch'); // age 18, expected 15
  });
  it('age_mismatch when older than the email implies (2+ classes)', () => {
    expect(checkEnrollmentAge({ dateOfBirth: new Date('2012-01-15'), graduationYear: 26, now }))
      .toBe('age_mismatch'); // age 14... NOTE: under_15 floor fires first — assert under_15
  });
});
```

NOTE the last case: the floor is checked BEFORE consistency — a 14-year-old with a terminale email is `under_15`, not `age_mismatch`. Fix the test to assert `under_15` and add a separate genuine too-old mismatch (e.g. DOB 2005 age 21, grad 26 expected 18 → `age_mismatch`).

- [ ] **Step 1.2:** Run → FAIL (module not found).

- [ ] **Step 1.3: implementation:**

```ts
const PARIS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});

function parisYmd(d: Date): { y: number; m: number; day: number } {
  const parts = PARIS_FMT.formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g('year'), m: g('month'), day: g('day') };
}

/**
 * The calendar year in which the CURRENT school year ends. September boundary,
 * Paris wall clock — matches getValidGraduationYears' convention.
 */
export function schoolYearEnd(now: Date): number {
  const { y, m } = parisYmd(now);
  return m >= 9 ? y + 1 : y;
}

/**
 * Expected age today for a student whose EJM email carries the given 2-digit
 * graduation year: 18 in terminale, one less per school year remaining.
 */
export function expectedAgeForGradYear(twoDigitGradYear: number, now: Date): number {
  const fullGradYear = 2000 + twoDigitGradYear;
  return 18 - (fullGradYear - schoolYearEnd(now));
}

export type AgeGateVerdict = 'ok' | 'under_15' | 'age_mismatch';

/** Full years elapsed between dob and now (calendar-accurate, Paris). */
function fullYears(dob: Date, now: Date): number {
  const n = parisYmd(now);
  const b = { y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, day: dob.getUTCDate() };
  let age = n.y - b.y;
  if (n.m < b.m || (n.m === b.m && n.day < b.day)) age -= 1;
  return age;
}

/**
 * Self-enrollment age gate (governance design §"Age policy"). The under-15
 * floor is checked FIRST and is never waivable; the ±1-class consistency check
 * is admin-exemptable at the call sites.
 */
export function checkEnrollmentAge(opts: {
  dateOfBirth: Date;
  graduationYear: number;
  now?: Date;
}): AgeGateVerdict {
  const now = opts.now ?? new Date();
  const age = fullYears(opts.dateOfBirth, now);
  if (age < 15) return 'under_15';
  const expected = expectedAgeForGradYear(opts.graduationYear, now);
  if (Math.abs(age - expected) > 1) return 'age_mismatch';
  return 'ok';
}
```

- [ ] **Step 1.4:** tests PASS; `pnpm --filter @ejm/shared-core build && pnpm --filter @ejm/shared-core test`. Commit: `feat(shared-core): enrollment age-policy helper`

## Task 2: exemptions collection + admin callables + rules

**Files:**
- Create: `apps/functions/src/admin/enrollmentExemptions.ts` (three callables: `setEnrollmentExemption`, `removeEnrollmentExemption`, `listEnrollmentExemptions`; follow the existing admin-callable idiom — see `apps/functions/src/admin/listUsers.ts` for the admin-auth guard pattern)
- Modify: `apps/functions/src/index.ts` (export), `firestore.rules` (new block), rules tests file for the collection

Doc shape `enrollmentExemptions/{ejmEmailLower}`: `{ createdByUid, createdAt, note? }`. The email is normalized (trim + lowercase) as doc id — the SAME normalization enrollment callables use for `ejemEmailLower`.

- [ ] **Step 2.1 (TDD):** rules tests first — admin can read, non-admin cannot, NOBODY can write client-side (all writes via admin SDK in callables). Integration tests: set → list shows it → remove → gone; non-admin caller gets permission-denied on all three.
- [ ] **Step 2.2:** rules block:

```
    // Enrollment exemptions: admin-managed waivers for the DOB/grad-year
    // consistency check (never the under-15 floor). Doc id = lowercased EJM
    // email. Written only by admin callables.
    match /enrollmentExemptions/{email} {
      allow read: if isAdmin();
      allow write: if false;
    }
```

- [ ] **Step 2.3:** implement callables (admin guard, zod on email + optional note ≤500 chars, `writeUserActivity` audit per call), green, commit: `feat(functions): admin-managed enrollment exemptions`

## Task 3: study — dual-signal gate in enrollTutor

**Files:**
- Modify: `apps/study-functions/src/enrollment/enrollTutor.ts` — insert AFTER the verification-code check succeeds and BEFORE any account/profile write (around the `ejemEmailLower` derivation at line ~93). Both paths (new-account AND add-profile) must pass the gate.
- Test: `tests/integration/enrollment/tutor-age-gate.test.ts` (new; follow the existing enrollment integration-test harness)

Implementation sketch:

```ts
import { validateEjmEmail, checkEnrollmentAge } from '@ejm/shared-core';

const emailCheck = validateEjmEmail(data.ejemEmail);
if (!emailCheck.valid || emailCheck.graduationYear === undefined) {
  throw new HttpsError('invalid-argument', emailCheck.error || 'Invalid EJM email');
}
const verdict = checkEnrollmentAge({
  dateOfBirth: new Date(enrollment.dateOfBirth),
  graduationYear: emailCheck.graduationYear,
});
if (verdict === 'under_15') {
  throw new HttpsError(
    'failed-precondition',
    'You need to be at least 15 to enroll on your own. Your parents can create an account and enroll you from theirs.',
    { code: 'age/under-15' },
  );
}
if (verdict === 'age_mismatch') {
  const exemption = await db.collection('enrollmentExemptions').doc(ejemEmailLower).get();
  if (!exemption.exists) {
    throw new HttpsError(
      'failed-precondition',
      "Your date of birth doesn't match your school year. Please contact the EJM administrator.",
      { code: 'age/mismatch' },
    );
  }
}
```

- [ ] **Step 3.1 (red):** integration cases — (a) 14-year-old, consistent email → rejected with details.code `age/under-15`; (b) DOB/grad-year mismatch → rejected `age/mismatch`; (c) same as (b) + admin sets exemption → enrollment SUCCEEDS; (d) 14-year-old + exemption → STILL rejected `age/under-15` (floor is not waivable); (e) consistent 16-year-old → succeeds (guards regression); (f) add-profile path with under-15 DOB → rejected.
- [ ] **Step 3.2:** implement, green (rebuild + emulator restart), commit: `feat(study-functions): under-15 and consistency gate in enrollTutor`

## Task 4: sit — searchBabysitters backstop

**Files:**
- Modify: `apps/functions/src/search/searchBabysitters.ts` — in the candidate loop (near the existing `calculateAge` use at line ~189)
- Test: extend the sit search integration tests (find the existing searchBabysitters test file and add a section)

Rules: candidates with a DOB that says `< 15` are excluded; candidates whose DOB/grad-year verdict is `age_mismatch` are excluded UNLESS `enrollmentExemptions/{their ejemEmailLower}` exists (fetch the exemption doc ONLY when the verdict fails — rare path, avoids N reads); candidates with NO dateOfBirth are NOT excluded (legacy accounts — the count script measures them). Grad year comes from `validateEjmEmail(profile.ejemEmail)`; if the stored email doesn't parse (legacy), skip the check entirely (do not exclude).

- [ ] **Step 4.1 (red):** integration cases — under-15 babysitter invisible in search; mismatched invisible; mismatched + exemption visible; missing-DOB visible; consistent 16-year-old visible.
- [ ] **Step 4.2:** implement + green. Commit: `feat(functions): age backstop in searchBabysitters`

## Task 5: client UX — both apps + admin exemptions page

**Files (implementer locates exact pages; follow each app's conventions):**
- study-web: the tutor signup/enrollment page — render the two `error.details?.code` branches as distinct friendly messages (not generic failure); i18n EN/FR.
- web (sit): the babysitter profile-completion step that collects dateOfBirth — client-side validation: under-15 shows the "your parents can create an account" message; grad-year mismatch (compute from the signed-in email) shows the contact-admin message. CLIENT-ONLY for sit (the server backstop is search) — comment this clearly.
- web (sit) admin section: an "Enrollment exemptions" panel — list / add (email + note) / remove via the Task 2 callables, following existing admin page idioms. Non-optimistic (refresh list after each mutation).
- Tests: page tests for the error-code branching (study), the DOB validation messages (sit), and the admin panel (callable payloads pinned). i18n keys: `enrollment.age.under15`, `enrollment.age.mismatch`, `admin.exemptions.{title,add,email,note,remove,empty}` EN + FR.

- [ ] **Step 5.1:** TDD per surface; keep study-web lint at ZERO; do not worsen the sit lint baseline (1 error / 7 warnings pre-existing).
- [ ] **Step 5.2:** Commit: `feat(web,study-web): age-gate UX and admin exemptions panel`

## Task 6: prod count script + gates

**Files:**
- Create: `apps/functions/count-underage-providers.cjs` + a `pnpm count:underage-providers` script in `apps/functions/package.json` (mirror `apps/study-functions/backfill-endorsement-counts.cjs` exactly: dry-run-only tool, `--project` flag, admin SDK, USER runs it in prod)

Output: for EACH provider profile (babysitter + tutor): counts of (a) DOB-under-15, (b) missing DOB, (c) unparseable ejemEmail, (d) DOB/grad-year mismatch beyond tolerance, with the affected uids listed. Read-only — it never writes.

- [ ] **Step 6.1:** implement + a smoke run against the emulator with seeded fixtures asserting the four buckets count correctly (script test may be a plain node invocation against the emulator, matching how the backfill script was verified).
- [ ] **Step 6.2:** Full gates: `pnpm typecheck && pnpm build`, unit suites, FULL emulator integration + rules suite. Commit: `feat(functions): underage-provider count script`

## Self-review notes

- The floor precedes the consistency check everywhere; exemptions NEVER waive the floor (test-pinned in Task 3d).
- Study rejects at enrollment; sit rejects at search — the asymmetry is deliberate and documented (enrollBabysitter has no DOB; a grad-year-only creation gate is vacuous inside the valid-email window). State it plainly in the PR body.
- All age math uses fixed `now` in tests; helper uses Paris wall clock; never epoch-day arithmetic.
- No new indexes (exemption reads are by doc id; search changes are in-memory filtering).
