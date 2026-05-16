# Agent 8 — Functional Test Plan

**Owner:** agent-8-tester (Agent 8 of the sync-study project)
**Project plan anchor:** [docs/sync-study-project-plan.md §8 → "Agent 8: Tester"](../sync-study-project-plan.md)
**Status:** Phase 0 — pending Phase 1 entry. Outline approved by the
coordinator on 2026-05-15. This document is the living test plan; it
gets re-run at every phase boundary.
**First commit on branch:** `feature/sync-study-agent-8-tester`

---

## 1. Binding Mandates

Lifted verbatim from §8 of the project plan; every section below
derives from these two.

1. **Sync-sit must not regress.** After every phase, exercise the full
   sync-sit functional surface (babysitter enrollment, parent
   enrollment, family invite, search, contact request, appointment
   lifecycle, schedule edit, references, admin actions, verification
   flow). If any pre-existing behavior changes, flag it as a
   regression.
2. **Sync-study scope must be fully implemented.** After Phase 3
   completes, verify every feature listed in §6 (Domain Model),
   §9 (V1 Scope Decisions), and Agent 5's task list is reachable
   end-to-end — tutor enrollment with subjects and session prefs,
   subject-based search, calendar slot picker with padding-aware
   availability, one-time and recurring session booking, instance-level
   cancel/reschedule, schoolWeeksOnly holiday handling.

### Pass-evidence vocabulary

Every row below names exactly one of these four artifact types as its
pass definition. "Looks right" is not a pass.

| Tag | Meaning |
|---|---|
| **Visual** | A specific DOM node renders with specific text / aria role / data-testid. Captured via Vitest + Testing Library assertion or manual screenshot. |
| **Log** | A specific log line is emitted at a specific level (browser console, Cloud Functions logs, emulator log). |
| **Network** | An HTTP call has the named method + path + status, or a Firebase callable returns the named shape. |
| **Firestore** | A document is written at the named collection path with the named field set. Verified via emulator console or `getDoc`. |

---

## 2. How This Plan Is Used

| When | Which table runs | Where the report lands |
|---|---|---|
| Phase -1 lint-cleanup completion (single SHA from `feature/sync-study-lint-cleanup`) | §3 sub-checklist only | `docs/agent-runs/agent-8-phase-minus-1-report.md` |
| Phase 1 completion (Agent 1 shared-core extraction) | §4 (sync-sit regression, full) | `docs/agent-runs/agent-8-phase-1-report.md` |
| Phase 2 completion (shared-functions extraction, Agents 2 + 3) | §4 (sync-sit regression, full) | `docs/agent-runs/agent-8-phase-2-report.md` |
| Phase 3 completion (Agents 4 + 5 — sync-study backend + frontend) | §4 (sync-sit, full) + §5 (sync-study scope) | `docs/agent-runs/agent-8-phase-3-report.md` |
| Phase 4 final (Agent 6 — rules, hosting, indexes) | §4 + §5 + §6 (cross-app) | `docs/agent-runs/agent-8-final-report.md` |

### Rules I do NOT break

- I never modify production code. If a test reveals a bug, I file it via
  `SendMessage` to team-lead, naming the agent who owns the surface.
- I never modify a test authored by another agent. If a pre-existing
  test is wrong, I file it the same way.
- I never touch `firestore.rules`, `firebase.json`, anything in
  `packages/`, anything under `apps/functions/src/` that pre-existed
  Phase 0. Those are owned by Agents 1, 3, and 6.
- I only author new files under `apps/web/src/**/__tests__/`,
  `apps/functions/src/**/__tests__/`, `apps/study-web/src/**/__tests__/`,
  `apps/study-functions/src/**/__tests__/`, and this `docs/agent-runs/`
  directory.

---

## 3. Phase -1 Lint-Cleanup Verification Sub-Checklist

**Trigger:** Single SHA from `feature/sync-study-lint-cleanup` reported
complete by the coordinator. Gate: pre-cleanup baseline is
`feature/sync-study-orchestration` HEAD before any lint-cleanup commit
(i.e. SHA `7eb83e7` at Phase 0).

**What changed there:** Six surfaces had `react-hooks/set-state-in-effect`
violations rewritten to replace effect-driven state with derived state.
Five are read-only data hooks; the sixth (`PhoneInput`) is a controlled
input whose previous `useEffect` re-parsed `value` on prop change.

**Verification technique — oracle-diff replay:**

For each hook surface, the test imports both the pre-cleanup
implementation (copied verbatim into a fixture
`__tests__/fixtures/<hook>.pre-cleanup.ts`) and the post-cleanup
implementation (from the live source). It drives both through the
same `(uid|familyId|value)` sequence using a shared `replayHook(...)`
harness and asserts that the emitted `(loading, ...rest)` frames are
identical on every render. Any divergence is a fail.

The harness lives at
`apps/web/src/hooks/__tests__/_helpers/replayHook.ts` and is the
*only* file I'll add outside the test files themselves. It mocks
`firebase/firestore`'s `onSnapshot` deterministically (a manually
triggered queue, not real Firestore) and mocks `useAuthStore` via
the Zustand v5 `setState` API.

### §3 row table

| # | Surface | File | Frame sequence to replay | Invariant under test | Pass definition |
|---|---|---|---|---|---|
| L1 | `useAppointments` | `apps/web/src/hooks/useAppointments.ts` | uid: `undefined → 'a' → 'a'(snapshot:empty) → 'a'(snapshot:1 pending + 1 confirmed-future + 1 confirmed-past + 1 rejected-recent + 1 resubmitted-rejected) → undefined → 'b' → 'b'(snapshot:empty)` | Returned `(loading, pending, confirmed, pastRecent, rejectedRecent)` is identical to oracle on every frame. Resubmitted-hidden rule preserved. `endTime`-past partition preserved. `PAST_VISIBILITY_DAYS` cutoff preserved. `loading` flips to false on first snapshot but stays false when uid goes back to `undefined`. | **Visual:** all five tuple fields equal oracle's at each frame. |
| L2 | `useEndorsements` | `apps/web/src/hooks/useEndorsements.ts` | uid: `undefined → 'a' → 'a'(snapshot:2 manual + 1 family_submitted + 1 removed) → 'a'(snapshot:after addManualReference)` | `(manualRefs, familySubmittedRefs, loading)` identical to oracle. `removed` filter preserved. Mutation callbacks (`addManualReference`, `updateManualReference`, `removeReference`, `publishReference`, `unpublishReference`) are memoized on `uid` only — their reference identity is stable across renders where uid is unchanged. | **Visual:** tuple equality across frames + `Object.is(prev.fn, next.fn)` true when uid is stable. |
| L3 | `useFamilyAppointments` | `apps/web/src/hooks/useFamilyAppointments.ts` | userDoc: `null → {role:'parent', familyId: undefined} → {role:'parent', familyId:'f1'} → snapshot(2 pending) → {role:'parent', familyId:'f2'} → snapshot(empty) → null` | `(loading, pending, confirmed, pastRecent, rejectedRecent)` identical to oracle. `familyId=undefined` branch flips loading=false without subscribing. `familyId` change re-subscribes correctly. | **Visual:** tuple equality across frames. |
| L4 | `useSchedule` | `apps/web/src/hooks/useSchedule.ts` | uid: `undefined → 'a' → snapshot(schedule doc missing) → snapshot(schedule present, weekly + holidayMode='different' + holidaySchedules) → overrides snapshot(empty) → overrides snapshot(2 overrides, dates out-of-order) → undefined` | `(weekly, holidayMode, holidaySchedules, holidayNotes, overrides, loading)` identical to oracle. `weekly` falls back to `createDefaultSchedule()` when schedule doc missing. `overrides` sorted ascending by `date`. `loading` flips on schedule snapshot, NOT on overrides snapshot. Two unsubs returned and both called on unmount. | **Visual:** tuple equality + both unsub fns invoked exactly once on cleanup. |
| L5 | `useSubmittedEndorsements` | `apps/web/src/hooks/useSubmittedEndorsements.ts` | uid: `undefined → 'a' → snapshot(3 refs, 1 removed) → snapshot(2 refs, 0 removed) → undefined` | `(references, loading)` identical to oracle. `removed` filter preserved. | **Visual:** tuple equality across frames. |
| L6 | `PhoneInput` | `apps/web/src/components/forms/PhoneInput.tsx` | (component-level, not hook): mount with `value="+33 0612345678"` → rerender with `value="+44 7700900123"` → user types `06` with `+33` reselected → user changes country select from `+33` to `+1` → rerender with `value=""` → rerender with `value="0612345678"` (no country prefix) | (a) initial render parses `value` into the right country code + digit-only number; (b) prop `value` change re-parses on the next render the new value arrives — the `<select>` and `<input>` both reflect the new value; (c) typing `06` with `+33` selected emits `onChange("+33 6")` (leading-zero strip); (d) typing `06` with `+1` selected emits `onChange("+1 06")` (no strip for non-FR); (e) changing the country select while a number is present re-emits via `formatFullNumber`; (f) value with no country prefix defaults to `+33` and treats the whole input as number. | **Visual:** rendered `<select>.value`, `<input>.value` match oracle on every frame. **Network proxy:** captured `onChange` payloads match oracle string-for-string. |

### §3 deliverables when I run this

When team-lead hands me the lint-cleanup SHA, I will:

1. Check out a detached read of that SHA into the existing checkout
   without disturbing my branch
   (`git fetch --all && git log <sha> && git diff <baseline>..<sha>
   -- apps/web/src/hooks apps/web/src/components/forms/PhoneInput.tsx`).
2. Author the six oracle files
   (`__tests__/fixtures/<hook>.pre-cleanup.ts(x)` — verbatim from the
   pre-cleanup source at baseline `7eb83e7`).
3. Author the `replayHook` helper and the six `*.behavior.test.ts(x)`
   tests, one per row.
4. Run `pnpm --filter web exec vitest run` and `pnpm typecheck &&
   pnpm build`.
5. Report PASS/FAIL with the exact failing frame index per row,
   including the diverging field. On FAIL the report names the
   originating agent (lint-cleanup commit author) and includes the
   minimal reproducing frame sequence.

### Why this technique is appropriate

The lint-cleanup rewrites are mechanical (effect → derived state), so
the oracle is a faithful frame-by-frame reference. Any visible
behavior change must show up as a frame-level divergence. This catches
both the obvious failure modes (e.g. an extra render emitted with
stale state) and the subtle ones (e.g. loading staying `true` an extra
frame on the uid-unset path).

---

## 4. Sync-Sit Regression Checklist

**Runs:** after Phase 1, Phase 2, Phase 3, Phase 4.
**Environment:** sync-sit web build of the integration branch +
Firebase emulators (`pnpm emulators`). The emulator seed is the existing
`apps/functions/seed-admin.cjs` (one admin user) plus the fixtures we
create per row.

For each row: `Surface` (which page or callable) → `Steps` (numbered,
terse) → `Expected result` → `Pass` (one of the four artifact tags).

### 4.1 Public / unauthed (4 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-pub-1 | WelcomePage + static pages (About, Privacy, Terms) | 1. Visit `/`. 2. Click About → Privacy → Terms via the footer. 3. Refresh on Privacy. | Pages render with i18n-correct copy (EN default, FR after language toggle). No console errors. | Visual + Log (no error-level console) |
| R-pub-2 | Forgot password | 1. From LoginPage click "Forgot password". 2. Enter a registered email. 3. Submit. 4. Switch to inbox (emulator UI) and click the reset link. 5. Set new password. 6. Log in with new password. | Reset email is captured by emulator; new password authenticates. | Firestore (`users/<uid>` unchanged shape) + Network (200 from `firebase.auth`) |
| R-pub-3 | Login (3 personas) | 1. Log in as babysitter (`b@ejm.example`). 2. Log out. 3. Log in as parent (`p@ejm.example`). 4. Log out. 5. Log in as admin (seeded). | Each persona lands on its role-specific dashboard (`/babysitter`, `/family`, `/admin`). | Visual (correct dashboard renders) + Log (`authStore.userDoc.role` matches) |
| R-pub-4 | SharePage + ReportProblemPage | 1. Visit `/share`, copy invite link. 2. Visit `/report-problem`, submit a description. | SharePage renders an active link; report submission writes to `auditLog` or invokes the report endpoint with 200. | Network (200 from report endpoint) |
| R-pub-5 | PWA install + add-to-homescreen | 1. Trigger install prompt in a supported browser. 2. Visit `/add-to-homescreen` on iOS user-agent. | PWA install prompt dispatches `beforeinstallprompt` handler; iOS page renders Safari-specific instructions. | Visual + Log |

### 4.2 Babysitter enrollment (6 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-bs-enroll-1 | StepEmail | 1. From SignUpRolePage choose Babysitter. 2. Enter EJM domain email. 3. Submit. | `verifyEjmEmail` callable invoked; advances to StepVerify. | Network (callable 200, `{ok:true}`) |
| R-bs-enroll-2 | StepVerify | 1. Enter the 6-digit code from emulator email. 2. Submit. | `verifyCode` succeeds; advances to StepPassword. | Network (callable 200) + Firestore (verification doc updated) |
| R-bs-enroll-3 | StepPassword | 1. Enter strong password matching `strongPasswordSchema`. 2. Submit. | Account created in Firebase Auth; advances to StepProfile. | Firestore (`users/<uid>` doc created with `role:'babysitter'`) |
| R-bs-enroll-4 | StepProfile | 1. Fill firstName, lastName, DOB, class, gender, languages, photo, address (AddressAutocomplete returns LatLng). 2. Submit. | `users/<uid>` updated; advances to StepPreferences. | Firestore (`users/<uid>` has profile fields per `babysitterProfileSchema`) |
| R-bs-enroll-5 | StepPreferences | 1. Set rate, availability areas (multi-select from `ALL_AREAS`), area mode, max kids. 2. Submit. | `enrollBabysitter` callable invoked; account becomes searchable. | Network (callable 200) + Firestore (`users/<uid>` has `searchable=true`, `status='active'`) |
| R-bs-enroll-6 | Full happy path end-to-end | Run 1–5 in sequence as a fresh user. | Final state: searchable babysitter visible in family search. | Firestore (`users/<uid>` matches `isBabysitterProfileComplete=true`) |

### 4.3 Parent enrollment (6 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-pa-enroll-1 | StepParentEmail | 1. From SignUpRolePage choose Parent. 2. Enter email. 3. Submit. | `verifyParentEmail` callable invoked; advances to StepParentVerify. | Network (callable 200) |
| R-pa-enroll-2 | StepParentVerify | 1. Enter code. 2. Submit. | `verifyCode` succeeds; advances. | Network (callable 200) |
| R-pa-enroll-3 | StepParentPassword | 1. Enter strong password. 2. Submit. | Account created; advances. | Firestore (`users/<uid>` with `role:'parent'`) |
| R-pa-enroll-4 | StepFamilyInfo | 1. Fill family name, address (LatLng), notification prefs. 2. Submit. | `enrollFamily` callable creates `families/<familyId>`. | Firestore (`families/<familyId>` doc per `familyEnrollmentSchema`) |
| R-pa-enroll-5 | StepKids | 1. Add 2 kids (name, age). 2. Submit. | Each kid written under `families/<familyId>/kids/{kidId}`. | Firestore (2 kid docs) |
| R-pa-enroll-6 | JoinFamilyPage (invite) | 1. Generate invite link from existing family (Step R-fam-2). 2. Open the link in a new browser as a second parent. 3. Enter email + code + password. 4. Submit. | `validateInviteLink` then `joinFamily` succeed; second parent added to family. | Firestore (`families/<familyId>.parentIds` array contains both uids) |

### 4.4 Family flows (7 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-fam-1 | Family Dashboard | 1. Log in as parent. 2. Land on `/family`. | Dashboard renders: search shortcut, upcoming appointments via `useFamilyAppointments`, family settings link. | Visual + Log (no error) |
| R-fam-2 | InvitePage — generate / validate / revoke | 1. Click "Invite co-parent". 2. Generate link. 3. Open `validateInviteLink` separately (DevTools or curl) with the token. 4. Revoke (`removeCoParent`). | Step 2 writes `inviteLinks/<id>`. Step 3 returns 200. Step 4 invalidates the link and removes uid from `families.parentIds`. | Firestore (inviteLinks doc + families.parentIds delta) + Network |
| R-fam-3 | SearchPage — searchBabysitters | 1. Set area, date range, kid count. 2. Submit. | Results show babysitters whose `searchable=true`, `status='active'`, and `areas` overlap. Distance is `haversineDistance(family, sitter)`. | Network (callable 200 with results array) + Visual |
| R-fam-4 | SearchPage → sendContactRequest | 1. Click a result card. 2. Send contact request. | `searches/<searchId>` doc created with `status='pending'`; babysitter receives notification. | Firestore (`searches/<searchId>`) + Firestore (`notifications/<id>` for the babysitter) |
| R-fam-5 | PreferredBabysittersPage | 1. `addPreferredBabysitter`. 2. `respondToContactSharing` (accept). 3. `removePreferredBabysitter`. | Each callable returns 200; family `preferredBabysitterIds` array reflects the changes. | Firestore (`families/<id>.preferredBabysitterIds` delta) + Network |
| R-fam-6 | FamilySettingsPage edit | 1. Open Family Settings. 2. Change family name. 3. Update notification prefs (email + push toggles). 4. Save. | Family doc updated; notifPrefs match input. | Firestore (`families/<familyId>`) |
| R-fam-7 | VerificationPage submit | 1. Open Verification. 2. Upload an ID image. 3. Submit. | `submitVerification` callable creates `verifications/<id>` with `status='pending'`. | Firestore (`verifications/<id>`) + Network |

### 4.5 Babysitter portal flows (7 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-bs-1 | DashboardPage | 1. Log in as babysitter. 2. Land on `/babysitter`. | Dashboard renders via `useAppointments` (pending/confirmed lists). | Visual + Log |
| R-bs-2 | BabysittingOptionsPage edit | 1. Change rate, areas, max kids. 2. Save. | `users/<uid>` updated; `searchable=true` preserved. | Firestore (delta) |
| R-bs-3 | SchedulePage — weekly edit | 1. Open WeeklyTimeline. 2. Toggle 4 slots (08:00–09:00 Tuesday). 3. Save. | `schedules/<uid>.weekly.tue` has 4 true booleans at indices 32–35 (15-min slots). | Firestore (`schedules/<uid>`) |
| R-bs-4 | SchedulePage — holidayMode | 1. Set holidayMode='different' with a holidayWeekly schedule. 2. Save. 3. Toggle to 'unavailable'. 4. Save again. | Both transitions persist; deprecated `holidayWeekly` is not re-written. | Firestore (`schedules/<uid>.holidayMode` + `holidaySchedules`) |
| R-bs-5 | EndorsementsPage — manual reference | 1. Add manual reference (name, phone). 2. Edit it. 3. Publish. 4. Unpublish. 5. Remove. | Each step writes `references/<id>` with the right `status`. The "remove" sets `status='removed'`, NOT a hard delete. | Firestore (`references/<id>.status` trail) |
| R-bs-6 | EndorsementsPage — family_submitted reference | 1. Family submits a reference (via R-fam-7-adjacent). 2. Babysitter views it in Endorsements. | Reference appears in the `family_submitted` column with `status` from the parent's submission. | Firestore (`references` doc + Visual on EndorsementsPage) |
| R-bs-7 | RequestDetailPage — full appointment lifecycle | See R-apt-* below; this row's pass is just that the page renders the appointment correctly at each lifecycle stage. | Page reflects status, recurringSlots, modification deltas, resubmission. | Visual |

### 4.6 Appointment lifecycle (5 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-apt-1 | respondToRequest — accept | 1. Family sends contact request (R-fam-4). 2. Babysitter accepts. | Family creates `appointments/<id>` with `status='pending'`; babysitter `respondToRequest('confirmed')` sets `status='confirmed'` and writes the schedule override. | Firestore (`appointments/<id>.status` and `schedules/<uid>/overrides/<date>` both present) |
| R-apt-2 | respondToRequest — decline | 1. Same setup. 2. Babysitter declines with reason. | `appointments/<id>.status='rejected'`, `statusReason` set, no schedule override. | Firestore (`appointments/<id>` delta) |
| R-apt-3 | modifyAppointment | 1. Confirmed appointment from R-apt-1. 2. Babysitter modifies endTime. | `appointments/<id>.modified=true`, `modifiedFields` includes `endTime`, family receives notification. | Firestore (delta) + Firestore (`notifications/<id>`) |
| R-apt-4 | acknowledgeModification | 1. From R-apt-3. 2. Family acknowledges the modification. | `appointments/<id>.modified=false` (cleared) or `acknowledgedAt` set per current implementation. | Firestore (delta) |
| R-apt-5 | resubmitAppointment | 1. Declined appointment from R-apt-2. 2. Family resubmits with adjusted time. | New appointment created with `resubmitted=true` reference flag; old appointment hidden from babysitter view (the `resubmitted` filter in `useAppointments`). | Firestore (old doc has `resubmitted` flag; new doc has `status='pending'`) |
| R-apt-6 | cancelAppointment | 1. Confirmed appointment. 2. Either party cancels. | `appointments/<id>.status='cancelled'`, `cancelledAt` set, schedule override removed. | Firestore (`appointments/<id>` delta + `schedules/<uid>/overrides/<date>` absent) |

### 4.7 Schedule edit details (4 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-sched-1 | Weekly slot toggle | 1. Open SchedulePage. 2. Use `setSlotRange(slots, 32, 35, true)` via the UI (drag select 08:00–09:00 Tue). | `weekly.tue` slots[32..35] all true; other days untouched. | Firestore (`schedules/<uid>.weekly`) |
| R-sched-2 | Override unavailable | 1. Add an override for a specific date with type='unavailable'. | `schedules/<uid>/overrides/<YYYY-MM-DD>` has `type:'unavailable'`, `reason:'manual'`, no `slots`. | Firestore |
| R-sched-3 | Override custom | 1. Add override with type='custom' and a slots boolean array. | Doc has `type:'custom'`, `slots` array length 96. | Firestore |
| R-sched-4 | Remove override | 1. Delete an override. | Doc deleted. | Firestore (`getDoc` returns `exists()=false`) |

### 4.8 Verification flow (3 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-ver-1 | submitVerification | 1. Family or babysitter uploads doc on VerificationPage. 2. Submit. | `verifications/<id>.status='pending'`, document stored in Cloud Storage at the correct path. | Firestore + Storage (object exists) |
| R-ver-2 | reviewVerification (admin) | 1. Admin opens VerificationsPage. 2. Approves the pending doc. | `verifications/<id>.status='approved'`, `users/<uid>.verified` updated. | Firestore (both docs) |
| R-ver-3 | Community code path | 1. Admin `generateCommunityCode`. 2. Family `lookupCommunityCode`. 3. Admin `approveCommunityCode`. | Each callable returns 200; final state is approved community-code verification. | Firestore + Network |

### 4.9 Admin actions (8 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-adm-1 | getAdminDashboard | 1. Admin loads `/admin`. | Dashboard renders counts; callable returns 200. | Network + Visual |
| R-adm-2 | listUsers + blockUser/deleteUser/resetUserPassword/deactivateUser | 1. Open UsersPage. 2. For one test user: block → unblock → reset password → deactivate → delete. | Each callable returns 200; `users/<uid>.status` reflects the sequence. | Firestore + Network |
| R-adm-3 | listAppointments + deleteAppointment | 1. Open AppointmentsPage. 2. Delete one appointment. | Doc deleted from `appointments/`. | Firestore |
| R-adm-4 | updateHolidays | 1. Open HolidaysPage. 2. Add a date range to next academic year. 3. Save. | `holidays/<academicYear>` doc updated. | Firestore |
| R-adm-5 | listAuditLogs | 1. Open AuditLogPage. | Logs render with entries from R-adm-2..R-adm-4. | Visual + Firestore (auditLog entries present) |
| R-adm-6 | exportUserData (GDPR) | 1. Open GdprExportPage. 2. Enter target user email. 3. Submit. | Callable returns JSON export including users, families, kids, schedules, appointments, references, verifications. | Network (callable response shape) |
| R-adm-7 | listPendingVerifications | 1. Open VerificationsPage. | Pending list matches `verifications/` where `status='pending'`. | Visual + Firestore |
| R-adm-8 | Preapproved email add/remove | 1. `addPreapprovedEmail`. 2. `listPreapprovedEmails`. 3. `removePreapprovedEmail`. | List reflects each operation. | Firestore |

### 4.10 Cross-cutting (3 rows)

| # | Surface | Steps | Expected result | Pass |
|---|---|---|---|---|
| R-x-1 | i18n EN ↔ FR parity | 1. For every page covered in §4.1–4.9, toggle language. 2. Spot-check headings, CTAs, error messages. | No raw translation keys leak to the DOM (no `t.something.something` strings rendered). | Visual (page snapshot per locale) |
| R-x-2 | FCM push prompt + receipt | 1. Log in as a babysitter on a push-capable browser. 2. Accept push prompt. 3. Trigger a notification (R-apt-1). | Service worker registers; FCM token written to `users/<uid>.notifChannels.push.token`; notification displayed. | Firestore (token write) + Visual (notification popup) |
| R-x-3 | Resend email + scheduled functions | 1. Trigger an email-sending flow (verification, R-bs-enroll-2). 2. Manually invoke `sendReminders` in the emulator. 3. Manually invoke `cleanupOldData`. | Resend payload visible in emulator function logs; scheduled functions complete without error. | Log (function logs) |

**Row count for §4: 51.** Estimated emulator runtime end-to-end: ~90 min
manual, plus the automatable hooks-level subset (R-bs-1, R-bs-3, R-bs-5,
R-fam-1, R-fam-5) which I will progressively cover with Vitest tests
under `apps/web/src/<feature>/__tests__/` once Phase 1 begins.

---

## 5. Sync-Study Scope-Coverage Matrix

**Runs:** after Phase 3 (full matrix) and after Phase 4 (re-run +
cross-app rows).
**Environment:** sync-study web build of the integration branch +
Firebase emulators with the sync-study collections rules in place.

Each row marks: `[A]` = automatable (vitest or hook test I will author),
`[M]` = manual repro against emulator, `[R]` = review-only / depends on
Agent 9's security sign-off.

### 5.1 §6 Domain Model (11 rows)

| # | Scope item | §6 anchor | Pass definition | Mode |
|---|---|---|---|---|
| SC-1 | `SubjectOffering` type exists in `@ejm/shared-core` with fields `(subject, levels[], rate)` | §6 "New Types" | TypeScript import of the type compiles; `babysitterImmutableProfileSchema`-equivalent for tutors validates a fixture. | [A] |
| SC-2 | `LocationPref` enum exists with the four members `family_home | tutor_home | online | library` | §6 "New Types" | Same as SC-1; exhaustive switch over the enum compiles. | [A] |
| SC-3 | `SessionDoc` shape matches §6 spec | §6 "SessionDoc" | A fixture `SessionDoc` validates against the new Zod schema (Agent 1) and round-trips through Firestore writer (Agent 4). | [A] |
| SC-4 | `SessionInstanceDoc` shape matches §6 spec | §6 "SessionInstanceDoc" | Same as SC-3 for instance doc. | [A] |
| SC-5 | `SUBJECTS` and `CLASS_LEVELS` constants are present and match §6 lists | §6 "Subject Taxonomy" | Const arrays equal the specified literal tuples. | [A] |
| SC-6 | Search flow steps 1–8 reachable end-to-end | §6 "Search Flow" | Family picks subject+level → `searchTutors` returns matching tutors → click tutor → `getTutorAvailability(uid, dr)` returns boolean grid → pick start+length → `bookSession` writes `SessionDoc` with `status='pending'` → tutor confirms. | [M] |
| SC-7 | Padding logic respects in-person vs. online | §6 "Padding Logic" | For `location='family_home'`: required free slots = `paddingMinutes + sessionLengthMinutes + paddingMinutes`. For `location='online'`: required = `sessionLengthMinutes` only. Verify via two `bookSession` calls with one differing field. | [A] (booking validator unit-testable) |
| SC-8 | Recurring instance generator creates an 8-week rolling window | §6 "Recurring Instance Management" | On `bookSession(type='recurring')` confirmation, 8 `SessionInstanceDoc` are written under `study-sessions/<id>/instances/`. | [M] (function trigger) |
| SC-9 | Instance-level cancel removes only that instance's schedule override | §6 "Recurring Instance Management" | Cancel one instance: `SessionInstanceDoc.status='cancelled'`, the matching `schedules/<tutor>/overrides/<date>` is deleted, other instances and their overrides untouched. | [M] |
| SC-10 | Instance-level reschedule = cancel original + create new one-off | §6 "Recurring Instance Management" | Reschedule one instance: original `SessionInstanceDoc.status='cancelled'` + new `SessionDoc(type='one_time')` created. | [M] |
| SC-11 | `schoolWeeksOnly=true` skips holiday weeks during instance generation | §6 "Recurring Instance Management" | With a holiday range set via `updateHolidays`, recurring booking with `schoolWeeksOnly=true` generates 0 instances in the holiday week, full instances outside. | [M] |

### 5.2 §9 V1 Scope Decisions (12 rows)

For each "No" decision in §9, verify the feature is NOT present in the UI
or data model. For "Yes" decisions, verify it IS present. The point is
to prevent scope creep, not just scope completion.

| # | Decision | §9 row | Pass definition | Mode |
|---|---|---|---|---|
| SC-NP-1 | Group tutoring is NOT in v1 | "Group tutoring: No" | No `participants[]` field present on `SessionDoc` write payloads. No "add second student" UI in booking flow. `SessionInstanceDoc` is structurally additive (`participants[]` can be added later without migration). | [A] (write-payload assertion) |
| SC-Y-1 | Per-subject pricing IS in v1 | "Per-subject pricing: Yes" | Tutor profile carries `SubjectOffering[]` with per-subject `rate`. Search result card shows rate range. `SessionDoc.rate` is locked at booking time. | [M] + [A] (search card snapshot) |
| SC-NP-2 | Session notes NOT in v1 | "Session notes: No" | No `preSessionNote` / `postSessionNote` fields on `SessionInstanceDoc`. No notes UI in session detail view. | [A] (type shape) |
| SC-Y-2 | Cancellation policy = same as sync-sit | "Cancellation policy: Same as babysitting" | Cancel-anytime works on `SessionDoc` and `SessionInstanceDoc` without a policy modal or fee calculation. | [M] |
| SC-NP-3 | Online session link NOT in v1 | "Online session link: No" | `SessionDoc` has no `meetingUrl` field. No "Generate meeting link" CTA in booking flow. | [A] (type shape) |
| SC-NP-4 | Tutor-initiated booking NOT in v1 | "Tutor-initiated booking: No" | Tutor portal has no "Create session for family" CTA. | [M] |
| SC-NP-5 | In-app messaging NOT in v1 | "In-app messaging: No" | No `/messages` route, no message-sending UI in either app. | [M] |
| SC-NP-6 | Waiting lists NOT in v1 | "Waiting lists: No" | When tutor has no availability, search result shows "no slots" — no "Join waiting list" CTA. | [M] |
| SC-NP-7 | Trial sessions NOT in v1 | "Trial sessions: No" | No `type:'trial'` value in the `SessionDoc.type` union (must be exactly `'one_time' | 'recurring'`). | [A] (type shape) |
| SC-NP-8 | Tutor qualifications display NOT in v1 | "Tutor qualifications display: No" | Tutor profile UI shows name, photo, languages, subjects, rate, distance — but NOT "degree" / "experience years" / "certifications" sections. | [M] |
| SC-NP-9 | No platform-managed online links | (same as SC-NP-3 but for UI) | No iframe / no integrated video component on session detail. Tutor can paste their own URL but it's a plain text field. | [M] |
| SC-NP-10 | No automated waiting-list expansion | (same as SC-NP-6 but for backend) | No Cloud Function listens for tutor-availability-changes and notifies waiting families. | [M] (function inventory check) |

### 5.3 Agent 5 frontend tasks (13 rows)

| # | Scope item | Agent 5 task # | Pass definition | Mode |
|---|---|---|---|---|
| SC-A5-1 | `apps/study-web/` Vite app scaffolds and starts | 1 | `pnpm --filter @ejm/study-web dev` starts a server on a free port; `/` renders the WelcomePage. | [M] |
| SC-A5-2 | Stores and hooks present | 2 | `authStore` with `profiles.study` awareness; `useSessions`, `useFamilySessions`, `useSchedule` exist and pass type checks. | [A] (hook tests) |
| SC-A5-3 | i18n EN + FR parity | 3 | For every page in SC-A5-4..SC-A5-13, no raw `t.foo.bar` keys leak in either locale. | [M] |
| SC-A5-4 | Layouts + AuthGuard | 4 | `AuthGuard` redirects an unauth'd user to `/login`. Tutor user is routed to `TutorLayout`, parent to `FamilyLayout`. | [M] |
| SC-A5-5 | Public pages render | 5 | Welcome, Login, SignUpRolePage, About, Privacy, Terms, guides — all render. | [M] |
| SC-A5-6 | TutorEnrollment with StepSubjects + StepSessionPrefs | 6 | Full tutor enrollment writes a `users/<uid>` doc with `role:'tutor'`, `subjects:SubjectOffering[]`, `sessionLengths:number[]`, `locations:LocationPref[]`, `paddingMinutes:number`. | [M] |
| SC-A5-7 | Parent enrollment (abbreviated path) | 7 | Existing sync-sit parent log in → abbreviated study enrollment skips email verification and reuses family. | [M] |
| SC-A5-8 | Subject-based search page | 8 | Search by subject+level returns tutors whose `subjects` array contains a matching `{subject, levels}` entry. Filters (location, max rate, distance) work. | [M] |
| SC-A5-9 | Calendar slot picker | 9 | Week-by-week view; clicking a day shows allowed start times per session length, with padding-aware availability. Family does NOT see padding blocks — only session start/end. | [M] (the bespoke component; hardest row) |
| SC-A5-10 | Tutor dashboard | 10 | Pending session requests (accept/decline), upcoming sessions list with instance-level rows. | [M] |
| SC-A5-11 | Family dashboard (tutoring) | 11 | Active sessions, upcoming instances, search shortcut, pending requests. | [M] |
| SC-A5-12 | Session detail views + instance list | 12 | One-time session detail renders all fields; recurring session detail shows instance list with per-instance cancel/reschedule actions. | [M] |
| SC-A5-13 | Tutor portal pages — Account, Schedule, Endorsements, Subjects | 13 | Each page renders and persists edits. SubjectsPage allows post-enrollment subject/level/rate management. | [M] |

### 5.4 Cross-app rows (4)

| # | Scenario | Pass definition | Mode |
|---|---|---|---|
| SC-CA-1 | A sync-sit parent enrolls into sync-study via the abbreviated flow | The parent's `users/<uid>` doc gains `profiles.study=true` without re-verifying email; their `familyId` is reused. | [M] |
| SC-CA-2 | A booking in one app blocks slots in the other | After R-apt-1 in sync-sit, `getTutorAvailability` for the same tutor at the same time returns false for those slots. The shared `schedules/<uid>/overrides/<date>` doc has `appSource='sit'`. The inverse holds: a sync-study booking blocks sync-sit. | [M] + [R] |
| SC-CA-3 | `appSource` cannot be set client-side to forge cross-app writes | A client SDK write attempt with `appSource:'spoof'` is rejected by Firestore rules. (Hand-off to Agent 9 for rule audit; I just probe the surface.) | [R] (Agent 9 owns the rules verdict) |
| SC-CA-4 | No PII leak across apps | `notifyParents` and the extracted shared notification senders include recipient validation; no babysitter-only field leaks into tutor responses or vice versa. (Hand-off to Agent 9.) | [R] |

**Row count for §5: 40.**

---

## 6. Post-Phase-4 Cross-App Scenarios (spelled out)

These are runnable scripts against the integration branch + emulators
after Phase 4. They overlap with §5.4 but spell out the user fixtures.

| # | Scenario | Preconditions | Steps | Pass |
|---|---|---|---|---|
| X-1 | Sit-only parent migrates to study | `users/<P>` with `profiles.sit=true, profiles.study=undefined` exists; matching `families/<F>` exists | 1. P opens study-web `/`. 2. Logs in. 3. Sees "Enable tutoring for your family" CTA. 4. Confirms. | `users/<P>.profiles.study=true`; no new family doc; no email verification triggered. |
| X-2 | Study booking blocks sit availability | Tutor T (role='tutor' AND role='babysitter' multi-role) exists with weekly schedule. T has no existing appointments or sessions. | 1. Family F1 books a study session with T on 2026-06-15 14:00–15:00. 2. Family F2 searches sit-side for babysitters on 2026-06-15 14:30–15:30. | T does NOT appear in F2's results. `schedules/<T>/overrides/2026-06-15` has `appSource='study'`. |
| X-3 | Sit booking blocks study availability | Same T setup, no bookings. | 1. Family F1 books a sit appointment with T on 2026-06-15 14:00–15:00. 2. Family F2 calls `getTutorAvailability(T, 2026-06-15..2026-06-15)`. | The grid for 14:00–15:00 is `false`. Override has `appSource='sit'`. |
| X-4 | Cancelling sit appointment unblocks study slot | After X-3. | 1. F1 cancels the sit appointment. 2. F2 re-calls `getTutorAvailability`. | The grid is `true` again. Override is deleted. |
| X-5 | Holiday handling cross-app | Holidays for 2026-04-13..2026-04-19 are set via `updateHolidays`. Tutor T has `schoolWeeksOnly=true` on a recurring session. | 1. Confirm the recurring session was generated for the next 8 weeks. | No `SessionInstanceDoc` exists for any day in the holiday range. |
| X-6 | i18n parity across both apps | Both apps deployed to integration branch | 1. Toggle FR on study-web. 2. Toggle FR on sit-web. | No raw translation keys leak in either app; shared keys render identically. |

---

## 7. Test-Artifact Placement & Naming

| Directory | What goes there | Authored by |
|---|---|---|
| `apps/web/src/hooks/__tests__/` | Hook tests (L1–L5 + future sit hook tests) | Agent 8 only |
| `apps/web/src/hooks/__tests__/_helpers/` | `replayHook.ts`, mock builders | Agent 8 only |
| `apps/web/src/hooks/__tests__/fixtures/` | Pre-cleanup oracle copies (one per L1–L5 row) | Agent 8 only |
| `apps/web/src/components/forms/__tests__/` | Component tests (L6 PhoneInput; future form-component tests) | Agent 8 only |
| `apps/web/src/<feature>/__tests__/` | Feature-level component/page tests | Agent 8 only |
| `apps/functions/src/<feature>/__tests__/` | Function-level tests for sit functions | Agent 8 only |
| `apps/study-web/src/**/__tests__/` | Tutoring app tests (when Phase 3 lands) | Agent 8 only |
| `apps/study-functions/src/**/__tests__/` | Tutoring backend tests (when Phase 3 lands) | Agent 8 only |

**Naming convention:** `<surface>.behavior.test.ts(x)` for the
oracle-diff replay tests and the regression coverage tests;
`<surface>.scope.test.ts(x)` for the §5 scope-coverage tests (so the
distinction between regression and scope is clear at the file-name
level).

**Helper conventions:**
- `replayHook(hookFn, frames)`: drives a hook through an ordered list
  of input frames and returns the per-frame output tuple. Reused
  across L1–L5.
- `mockSnapshot(docs)`: builds a fake Firestore `QuerySnapshot` whose
  `docs` array can be triggered into the `onSnapshot` callback on
  demand.
- `mockAuthStore({uid, userDoc})`: a `useAuthStore` mock that supports
  `setState` mid-render so we can drive the hook through uid
  transitions.

**Forbidden moves:**
- Editing any test file authored by another agent. If a pre-existing
  test is wrong, I file a `SendMessage` report and let the originating
  agent fix it.
- Adding tests that hit live Firestore / Auth (must be emulator or mocked).
- Adding flaky tests with arbitrary `setTimeout` waits.

---

## 8. Resolved Decisions (Phase 0)

The three open questions from the outline phase, resolved by team-lead
on 2026-05-15:

| # | Question | Resolution |
|---|---|---|
| Q1 | Vitest infra in `apps/web` — where does it live, who installs it? | Agent 8 scaffolds it directly: `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`, devDeps on `apps/web/package.json` (`vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/dom`). Treated as part of Agent 8's test-ownership scope. Committed at SHA `9992b8a` on `feature/sync-study-agent-8-tester`. |
| Q2 | Is lint-cleanup the only in-flight change right now? | Yes. Phase 1 has not started. The §3 sub-checklist gates against pre-cleanup baseline `7eb83e7` (`feature/sync-study-orchestration` HEAD at Phase 0). |
| Q3 | Playwright? | No new Playwright suite (§8 "Skills Explicitly Skipped" excludes it). Built-in `webapp-testing` is available when a flow can't be reached cheaply via vitest or manual smoke. `e2e-testing-patterns` informs technique only — no `playwright` dep is to be added. |

---

## 9. Coordinator Sign-Off

This document was approved at outline stage by team-lead on
2026-05-15. The full content is delivered with the Phase 0 commit
listed below; further revisions happen by amendment with a
sign-off-here entry.

| Phase | Approved on | Coordinator | Notes |
|---|---|---|---|
| Phase 0 (this document) | 2026-05-15 | team-lead | Outline approved; full doc to be committed on `feature/sync-study-agent-8-tester`. |
| Phase -1 (lint-cleanup sub-checklist execution) | — | — | Pending lint-cleanup SHA. |
| Phase 1 (sync-sit regression after Agent 1) | — | — | |
| Phase 2 (sync-sit regression after Agents 2 + 3) | — | — | |
| Phase 3 (sync-sit + sync-study scope) | — | — | |
| Phase 4 (full pass + cross-app) | — | — | |
