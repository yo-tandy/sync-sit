# Cancellation Policies (V2 feature 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-tutor cancellation-notice policy (none/24h/48h/1 week), snapshotted onto each session at request time, with late cancellations allowed but flagged (`lateCancellation: true`) in both directions and surfaced in search, booking, cancel flows, and session lists.

**Architecture:** The policy is a tutor-editable profile preference (`profiles.tutor.cancellationNoticeHours`, preset values only). It is deliberately NOT rules-pinned: safety comes from **snapshotting** the value onto the session document when the request is created (bookSession/proposeSession), so a tutor editing the policy later cannot retro-flag existing bookings. Cancel callables compare each confirmed commitment's Paris-wall-clock start against `now + noticeHours` and set `lateCancellation: true` on the commitment that was late (one_time session doc, or individual instances — never the recurring parent). Enforcement is soft (user decision): the cancel always succeeds; the flag plus a policy note in notifications provides accountability. Study-only v1; the preset type lives in shared-core as the sit-adoption seam (same pattern as `ProposedBy`).

**Tech Stack:** TypeScript, Firebase callable functions (europe-west1), Firestore, zod, vitest (+ emulator integration suite), React 19 + study-web conventions (i18n EN/FR, non-optimistic mutations).

**User decisions (2026-07-28):** per-provider presets; allow-but-flag; both directions (family AND tutor late-cancels flagged, measured against the tutor's own policy); study-only v1 with shared-core seam.

**What does NOT change:** firestore.rules (no new pin — see snapshot rationale above; add the explanatory comment only), override-ledger restore logic, notice-window booking guard (`NOTICE_HOURS = 24` for *booking* lead time is unrelated to cancellation policy), enrollTutor (policy is not collected at enrollment; tutors set it later in Account).

---

## File map

| File | Change |
|---|---|
| `packages/shared-core/src/types/appointment.ts` | Add `CANCELLATION_NOTICE_PRESETS` + `CancellationNoticeHours` (sit seam, next to `ProposedBy`) |
| `packages/study-core/src/types/tutorProfile.ts` | Add `cancellationNoticeHours?: number` to TutorProfile |
| `packages/study-core/src/types/searchResult.ts` | Add `cancellationNoticeHours: number` to TutorSearchResult |
| `apps/study-functions/src/sessions/lateCancellation.ts` | **Create** — pure `isLateCancellation()` helper |
| `apps/study-functions/src/types/session.ts` | Add `cancellationNoticeHours?: number` + `lateCancellation?: boolean` |
| `apps/study-functions/src/types/sessionInstance.ts` | Add `lateCancellation?: boolean` |
| `apps/study-functions/src/sessions/bookSession.ts` | Snapshot policy onto BOTH payloads (recurring + one_time) |
| `apps/study-functions/src/sessions/proposeSession.ts` | Snapshot policy onto the proposal payload |
| `apps/study-functions/src/sessions/cancelSession.ts` | Flag late one_time session / late recurring instances; policy note in notifications |
| `apps/study-functions/src/sessions/cancelSessionInstance.ts` | Flag late instance; policy note in notification |
| `apps/study-functions/src/search/searchTutors.ts` | Project `cancellationNoticeHours` into results |
| `firestore.rules` | Comment-only: why cancellationNoticeHours is intentionally unpinned |
| `apps/study-functions/src/sessions/__tests__/lateCancellation.test.ts` | **Create** — unit tests (boundary, zero, DST) |
| `tests/integration/study-sessions/cancellation-policy.test.ts` | **Create** — emulator matrix (snapshot, flagging, retro-edit protection, search projection) |
| `apps/study-web/src/pages/tutor/AccountPage.tsx` | Cancellation-policy selector section |
| `apps/study-web/src/components/family/TutorCard.tsx` | Policy line when noticeHours > 0 |
| `apps/study-web/src/pages/family/BookSessionPage.tsx` | Policy note near submit |
| `apps/study-web/src/components/sessions/ReasonModal.tsx` | Optional `warning` prop (amber text above reason field) |
| `apps/study-web/src/pages/family/SessionsPage.tsx` + `apps/study-web/src/pages/tutor/SessionsPage.tsx` | Compute late-warning for ReasonModal; late badge on cancelled cards |
| `apps/study-web/src/components/sessions/SessionInstanceList.tsx` | Late badge on cancelled instances; late-warning pass-through for per-instance cancel |
| `apps/study-web/src/i18n/en.ts` + `fr.ts` | New keys (see Task 8) |
| study-web page tests | Selector writes correct dot-path; badge renders; warning renders |

---

## Task 1: Shared-core preset type + profile/type fields

**Files:**
- Modify: `packages/shared-core/src/types/appointment.ts` (append after the `ProposedBy` block)
- Modify: `packages/study-core/src/types/tutorProfile.ts` (after `paddingMin`)
- Modify: `packages/study-core/src/types/searchResult.ts` (after `endorsementCount`)
- Modify: `apps/study-functions/src/types/session.ts` (after `paddingMinutes`), `apps/study-functions/src/types/sessionInstance.ts` (after `cancellationReason`)

- [ ] **Step 1.1: shared-core seam** — append to `packages/shared-core/src/types/appointment.ts`:

```ts
/**
 * Cancellation-notice policy presets (V2 feature 7). A provider-chosen minimum
 * notice for cancelling a CONFIRMED commitment, in hours before the session's
 * Paris wall-clock start. 0 = no policy (never flags). Cancellations inside the
 * window still succeed but are recorded with `lateCancellation: true` on the
 * commitment (soft enforcement — this is a school community; emergencies happen).
 * The value is SNAPSHOTTED onto the session at request-creation time, so a
 * provider editing their policy later cannot retroactively re-classify existing
 * bookings. Study-only in v1; lives here (like ProposedBy) as the seam for
 * sync-sit adoption.
 */
export const CANCELLATION_NOTICE_PRESETS = [0, 24, 48, 168] as const;
export type CancellationNoticeHours = (typeof CANCELLATION_NOTICE_PRESETS)[number];
```

Verify `packages/shared-core/src/types/appointment.ts` is re-exported from the package index (it is — `ProposedBy` already flows through); no index change expected.

- [ ] **Step 1.2: TutorProfile field** — in `packages/study-core/src/types/tutorProfile.ts`, after the `paddingMin` block:

```ts
  /**
   * Cancellation-notice policy in hours (one of CANCELLATION_NOTICE_PRESETS;
   * absent → 0 = no policy). Tutor-editable directly (like paddingMin) and
   * deliberately NOT rules-pinned: enforcement reads the snapshot taken onto
   * each session at request time, never this live value.
   */
  cancellationNoticeHours?: number;
```

- [ ] **Step 1.3: search result field** — in `packages/study-core/src/types/searchResult.ts`, after `endorsementCount`:

```ts
  /** Tutor's cancellation-notice policy in hours (0 = no policy). */
  cancellationNoticeHours: number;
```

- [ ] **Step 1.4: session/instance doc fields** — in `apps/study-functions/src/types/session.ts` after `paddingMinutes`:

```ts
  // ── Cancellation policy (V2 feature 7) ──
  // Snapshot of the tutor's profiles.tutor.cancellationNoticeHours taken when
  // the request was CREATED (bookSession / proposeSession). Late determination
  // always reads this snapshot; later profile edits are inert for this session.
  cancellationNoticeHours?: number;
  // Set true (one_time only) when the cancel happened inside the notice window
  // while the session was CONFIRMED. Recurring lateness lives per-instance.
  lateCancellation?: boolean;
```

and in `apps/study-functions/src/types/sessionInstance.ts` after `cancellationReason`:

```ts
  // True when this occurrence was cancelled inside the parent session's
  // cancellationNoticeHours window while scheduled (V2 feature 7). Never set
  // on conflict_skip or pending-cancel paths.
  lateCancellation?: boolean;
```

- [ ] **Step 1.5:** `pnpm --filter @ejm/shared-core build && pnpm --filter @ejm/study-core build && pnpm --filter study-functions typecheck` → PASS. Commit: `feat(shared-core,study-core): cancellation-notice policy types`

## Task 2: `isLateCancellation` helper (TDD)

**Files:**
- Create: `apps/study-functions/src/sessions/lateCancellation.ts`
- Create: `apps/study-functions/src/sessions/__tests__/lateCancellation.test.ts`

- [ ] **Step 2.1: failing unit tests** (vitest, pure — no emulator). Cases:

```ts
import { describe, it, expect } from 'vitest';
import { isLateCancellation } from '../lateCancellation.js';

// Paris is UTC+2 on 2026-07-30 (CEST): 10:00 wall = 08:00Z.
const now = new Date('2026-07-29T08:00:00Z'); // exactly 24h before start

describe('isLateCancellation', () => {
  it('flags a cancel strictly inside the window', () => {
    expect(isLateCancellation('2026-07-30', '10:00', 48, now)).toBe(true);
  });
  it('does not flag exactly AT the cutoff (strict <)', () => {
    expect(isLateCancellation('2026-07-30', '10:00', 24, now)).toBe(false);
  });
  it('does not flag outside the window', () => {
    expect(isLateCancellation('2026-08-10', '10:00', 48, now)).toBe(false);
  });
  it('noticeHours 0 never flags, even seconds before start', () => {
    expect(isLateCancellation('2026-07-29', '10:05', 0, now)).toBe(false);
  });
  it('a cancel AFTER the start is late (start already inside any window)', () => {
    expect(isLateCancellation('2026-07-28', '10:00', 24, now)).toBe(true);
  });
  it('handles the CET/CEST boundary (2026-10-25 fall-back date)', () => {
    // 2026-10-26 09:00 Paris = 08:00Z (CET, UTC+1 after the 10-25 fall-back).
    // 47h before = 2026-10-24T09:00:00Z → inside a 48h window.
    expect(isLateCancellation('2026-10-26', '09:00', 48, new Date('2026-10-24T09:00:00Z'))).toBe(true);
    // 49h before = 2026-10-24T07:00:00Z → outside.
    expect(isLateCancellation('2026-10-26', '09:00', 48, new Date('2026-10-24T07:00:00Z'))).toBe(false);
  });
});
```

- [ ] **Step 2.2:** Run `pnpm --filter study-functions test -- lateCancellation` → FAIL (module not found).

- [ ] **Step 2.3: implementation** — `apps/study-functions/src/sessions/lateCancellation.ts`:

```ts
import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';

/**
 * True when cancelling now, a commitment starting at `date`+`startTime`
 * (Paris wall clock) falls inside the `noticeHours` cancellation window.
 * Strict `<`: cancelling exactly at the cutoff is on-time. A cancel after the
 * start has trivially violated any window. noticeHours <= 0 → never late.
 */
export function isLateCancellation(
  date: string,
  startTime: string,
  noticeHours: number,
  now: Date,
): boolean {
  if (noticeHours <= 0) return false;
  const start = parisWallTimeToUtc(date, startTime);
  return start.getTime() < now.getTime() + noticeHours * 60 * 60 * 1000;
}
```

- [ ] **Step 2.4:** tests PASS. Commit: `feat(study-functions): isLateCancellation helper`

## Task 3: Snapshot the policy at request creation

**Files:**
- Modify: `apps/study-functions/src/sessions/bookSession.ts` (BOTH payloads: the recurring `sessionDoc` around line 275–300 and the one_time `sessionDoc` around line 350–375 — each already writes `paddingMinutes`)
- Modify: `apps/study-functions/src/sessions/proposeSession.ts` (the `sessionDoc` at ~line 153; `tutor` profile already loaded at line ~106)
- Test: `tests/integration/study-sessions/cancellation-policy.test.ts` (new file; follow `propose-session.test.ts` harness conventions — seed helpers, callable invocation, `Authorization: Bearer owner` REST ground truth)

- [ ] **Step 3.1: failing integration tests** — in the new test file, section "policy snapshot":
  1. Seed tutor with `profiles.tutor.cancellationNoticeHours: 48`; family books one_time → session doc has `cancellationNoticeHours: 48`.
  2. Same tutor, recurring book → parent doc has `cancellationNoticeHours: 48`.
  3. Tutor proposes (proposeSession) → proposal doc has `cancellationNoticeHours: 48`.
  4. Tutor WITHOUT the field → booked session doc has `cancellationNoticeHours: 0`.

- [ ] **Step 3.2:** Run against emulator → FAIL (field absent).

- [ ] **Step 3.3: implementation** — in each of the three payloads, directly under `paddingMinutes,` add:

```ts
        cancellationNoticeHours: tutor.cancellationNoticeHours ?? 0,
```

(`tutor` is the already-loaded tutor profile in all three callables; in bookSession it's the same object that supplies `tutor.paddingMin`.)

- [ ] **Step 3.4:** tests PASS. Commit: `feat(study-functions): snapshot cancellation policy at request creation`

## Task 4: Late flagging in cancelSession

**Files:**
- Modify: `apps/study-functions/src/sessions/cancelSession.ts`
- Test: extend `tests/integration/study-sessions/cancellation-policy.test.ts`

Semantics: only CONFIRMED commitments can be late. Pending cancels never flag. Recurring parents never flag (lateness lives on instances). `date`, `startTime`, and the snapshot are immutable once written, so lateness for the one_time path may be computed from the pre-transaction `session` read.

- [ ] **Step 4.1: failing integration tests** — section "cancelSession flagging":
  1. Family cancels a CONFIRMED one_time starting tomorrow 10:00, policy 48 → session has `lateCancellation: true`, `statusReason: 'cancelled_by_family'`.
  2. TUTOR cancels same shape → `lateCancellation: true`, `statusReason: 'cancelled_by_tutor'` (both directions).
  3. Cancel a confirmed one_time 10 days out, policy 48 → NO `lateCancellation` key on the doc (assert absence, not false).
  4. Policy 0, cancel 1h before start → no key.
  5. Cancel a PENDING request starting in 2h, policy 48 → no key (pending is never late).
  6. Confirmed recurring weekly series, policy 48, instances tomorrow + (tomorrow+7d): cancelSession → tomorrow's instance has `lateCancellation: true`; the +7d instance does NOT; the PARENT doc does NOT.
  7. **Retro-edit protection:** book with policy 24 → tutor edits profile to 168 → family cancels 30h before start → NO flag (snapshot 24 governs).

- [ ] **Step 4.2:** Run → FAIL.

- [ ] **Step 4.3: implementation** — in `cancelSession.ts`:

After `const cancelFields = {...}` (line ~115) add:

```ts
    const noticeHours = (session.cancellationNoticeHours as number | undefined) ?? 0;
```

In the confirmed **one_time** branch, replace `tx.update(sessionRef, cancelFields);` with:

```ts
        const late = isLateCancellation(
          fresh.date as string,
          fresh.startTime as string,
          noticeHours,
          now,
        );
        tx.update(sessionRef, late ? { ...cancelFields, lateCancellation: true } : cancelFields);
```

In the confirmed **recurring** loop, replace the instance `tx.update` payload with:

```ts
        const instData = affected[i].data();
        const instLate = isLateCancellation(
          instData.date as string,
          instData.startTime as string,
          noticeHours,
          now,
        );
        tx.update(affected[i].ref, {
          status: 'cancelled',
          statusReason,
          cancellationReason: reason,
          cancelledAt: now,
          updatedAt: now,
          ...(instLate ? { lateCancellation: true } : {}),
        });
```

Have the transaction return whether anything was late (`{ type, late }`) so the notification section can append the policy note. Import the helper at the top:

```ts
import { isLateCancellation } from './lateCancellation.js';
```

- [ ] **Step 4.4: notification note** — where `seriesNote` is built, add:

```ts
    const latePolicyNote = outcome.late
      ? `<p>This was a <strong>late cancellation</strong> under the ${noticeHours}-hour notice policy.</p>`
      : '';
```

Append `latePolicyNote` after the Reason line in BOTH email bodies (family-cancelled and tutor-cancelled paths), and append `' (late cancellation)'` to the in-app/push `body` string when `outcome.late`. Include `late: outcome.late === true` in the `writeUserActivity` details.

- [ ] **Step 4.5:** tests PASS (rebuild + restart emulator functions first). Commit: `feat(study-functions): flag late cancellations in cancelSession`

## Task 5: Late flagging in cancelSessionInstance

**Files:**
- Modify: `apps/study-functions/src/sessions/cancelSessionInstance.ts`
- Test: extend `tests/integration/study-sessions/cancellation-policy.test.ts`

- [ ] **Step 5.1: failing tests** — section "cancelSessionInstance flagging":
  1. Confirmed recurring, policy 48: family cancels ONLY tomorrow's instance → that instance has `lateCancellation: true`; parent stays confirmed and unflagged.
  2. Cancel the +7d instance → no key.

- [ ] **Step 5.2:** FAIL, then implement identically to Task 4's instance path: read `noticeHours` from the PARENT session doc snapshot (`session.cancellationNoticeHours ?? 0` — the parent is already loaded), compute with the instance's `date`/`startTime`, spread `lateCancellation: true` into the instance cancel payload when late, append the same notification note + `' (late cancellation)'` suffix when late.

- [ ] **Step 5.3:** tests PASS. Commit: `feat(study-functions): flag late instance cancellations`

## Task 6: searchTutors projection + rules comment

**Files:**
- Modify: `apps/study-functions/src/search/searchTutors.ts` (the `result: TutorSearchResult = {...}` literal, after `endorsementCount`)
- Modify: `firestore.rules` (comment only, in the tutorIdentityUnchanged block's NOTE about searchable)
- Test: extend the integration file, section "search projection"

- [ ] **Step 6.1: failing test:** verified family searches; tutor with policy 48 returns `cancellationNoticeHours: 48`; tutor without the field returns `0`.

- [ ] **Step 6.2: implementation** — add to the result literal:

```ts
        cancellationNoticeHours: tutor.cancellationNoticeHours ?? 0,
```

- [ ] **Step 6.3: rules comment** — extend the existing NOTE in firestore.rules (the `searchable` note, line ~134):

```
      // NOTE: `profiles.tutor.cancellationNoticeHours` is also intentionally
      //   editable — enforcement reads the per-session SNAPSHOT taken at
      //   request time (bookSession/proposeSession), so live edits cannot
      //   retro-classify existing bookings.
```

- [ ] **Step 6.4:** tests PASS; run the FULL rules + integration suite (no rules behavior change expected). Commit: `feat(study-functions): project cancellation policy into search results`

## Task 7: study-web — policy setting, display, warnings, badges

**Files:**
- Modify: `apps/study-web/src/pages/tutor/AccountPage.tsx`, `apps/study-web/src/components/family/TutorCard.tsx`, `apps/study-web/src/pages/family/BookSessionPage.tsx`, `apps/study-web/src/components/sessions/ReasonModal.tsx`, `apps/study-web/src/components/sessions/SessionInstanceList.tsx`, `apps/study-web/src/pages/family/SessionsPage.tsx`, `apps/study-web/src/pages/tutor/SessionsPage.tsx`, `apps/study-web/src/types/studySession.ts`
- Tests: sibling `__tests__` files per touched page/component (follow existing patterns; RTL + vitest)

- [ ] **Step 7.1: types** — add `cancellationNoticeHours?: number; lateCancellation?: boolean;` to the session type and `lateCancellation?: boolean` to the instance type in `apps/study-web/src/types/studySession.ts` (mirror the functions-side names exactly).

- [ ] **Step 7.2 (TDD per page): AccountPage selector** — a "Cancellation policy" section: native select with the four presets labeled via i18n (none / 24 hours / 48 hours / 1 week), current value from `profiles.tutor.cancellationNoticeHours ?? 0`, Save via the page's existing `updateDoc(doc(db, 'users', uid), { 'profiles.tutor.cancellationNoticeHours': value, updatedAt: serverTimestamp() })` pattern (see SubjectsPage.handleSave for the idiom: saving state, refreshUserDoc, transient success). Page test pins the dot-path AND the numeric value written.

- [ ] **Step 7.3: TutorCard** — when `tutor.cancellationNoticeHours > 0`, render a policy line with the humanized window (24h/48h → hours, 168 → 1 week) using the same secondary-text style as the sessionLengths line. Test: renders for 48, absent for 0.

- [ ] **Step 7.4: BookSessionPage** — near the submit button, when the selected tutor's `cancellationNoticeHours > 0`, show an informational note (`t('family.book.cancellationPolicy', { window })`). The page already receives the TutorSearchResult (via navigation state / lookup) — verify the value flows; if the page re-derives the tutor from getTutorAvailability or route state, thread `cancellationNoticeHours` from the search result it navigated with.

- [ ] **Step 7.5: ReasonModal warning prop** — add optional `warning?: string`; when set, render an amber warning paragraph above the reason textarea (follow the modal's existing style tokens; no behavior change otherwise).

- [ ] **Step 7.6: cancel flows compute the warning** — in family/tutor SessionsPage and SessionInstanceList cancel paths: with the target's `date`, `startTime`, and the session's `cancellationNoticeHours` snapshot, compute client-side `new Date(...)` lateness (duplicate the strict-< rule; Paris offset via the existing client date utilities — approximate client-side is acceptable, the SERVER flag is authoritative) and pass `warning={t('sessions.lateCancelWarning', { window })}` when late. For a recurring series cancel, warn if the NEXT scheduled instance is inside the window.

- [ ] **Step 7.7: late badges** — on cancelled cards/instances with `lateCancellation === true`, render a small "Cancelled late" chip (both portals; same chip idiom as the trial badge from #99). Tests: badge renders when flag true, absent otherwise; existing where-args pins untouched.

- [ ] **Step 7.8: i18n** — add EN/FR keys: `tutor.account.cancellationPolicy.{title,help,none,hours24,hours48,week1,save,saved}`, `family.book.cancellationPolicy`, `family.search.cancellationNotice`, `sessions.lateCancelWarning`, `sessions.cancelledLateBadge`. FR translations required (follow file conventions; no hardcoded strings).

- [ ] **Step 7.9:** `pnpm --filter study-web test && pnpm --filter study-web lint && pnpm --filter study-web build` → all green, lint stays ZERO. Commit: `feat(study-web): cancellation policy setting, warnings, and late badges`

## Task 8: Gates + docs

- [ ] **Step 8.1:** Full monorepo gates: `pnpm typecheck && pnpm build && pnpm lint`, unit suites, FULL emulator integration + rules suite (build all six packages; emulator recipe per session conventions).
- [ ] **Step 8.2:** Update `docs/sync-study-project-plan.md` §10: mark feature 7 as shipped-in-study (one line, matching how V1.1 items were annotated, if they were; otherwise skip).
- [ ] **Step 8.3:** Completion report; controller reviews, opens PR.

## Self-review notes

- Snapshot-at-request (not confirm): the policy the family saw when committing is the one that governs; respondToSession needs NO change (confirm never touches the field).
- Assert flag ABSENCE (not `false`) on on-time cancels — the field is only ever written `true`.
- The recurring parent doc is never flagged: commitment granularity is the instance; UI badges read instances (and the one_time session doc).
- proposeSession's `tutor` is the CALLER's own profile (provider proposes) — snapshot source is identical.
- No index changes: no new queries.
